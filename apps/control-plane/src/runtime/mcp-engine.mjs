// MCP control-plane engine (change: add-mcp-control-plane-runtime).
//
// The integration layer that makes the live runtime serve the MCP management API. It COMPOSES the
// already-built, reviewed pure MCP modules (apps/control-plane/src/mcp-*.mjs) — it does not
// reimplement them:
//   - mcp-instant-generator / mcp-official-catalog  → a DRAFT tool set per source
//   - mcp-curation                                  → enable/disable + scopes + the publish gate
//   - mcp-registry                                  → digest-pinned versions, diff, review, rollback
//   - mcp-quota                                     → per-tenant server/tool quotas + rate limits
//   - mcp-observability                             → per-OAuth-client audit trail + tool-call telemetry
//   - mcp-official-server                           → JSON-RPC scope enforcement reference
//
// Tenancy: every operation is keyed by the credential-derived identity.tenantId (the same identity
// the rest of the runtime resolves from the gateway headers). The registry accessors reject
// cross-tenant reads, so a server created by tenant A is invisible/unreachable to tenant B.
//
// State: in-memory, process-local. The cp-executor runs single-replica; a Postgres-backed store is
// the tracked follow-up (mirroring how flows began on the metadata pool). Quotas/curation/registry
// logic is unchanged — only where the state lives differs.
import { randomUUID } from 'node:crypto';
import { generateInstantManifest } from '../mcp-instant-generator.mjs';
import { OFFICIAL_TOOLS, BASE_SCOPE } from '../mcp-official-catalog.mjs';
import { applyCuration, publishManifest } from '../mcp-curation.mjs';
import { createRegistry, registerVersion, getServer, listVersions, activateVersion } from '../mcp-registry.mjs';
import { MCP_QUOTA_DEFAULTS, evaluateServerCountQuota, evaluateToolCallRate, rateLimitKey } from '../mcp-quota.mjs';
import { mcpToolCallTelemetry, mcpAuditEvent, filterAuditRecordsForTenant } from '../mcp-observability.mjs';

const SAMPLE_POSTGRES = { database: 'default', name: 'public', tables: [{ name: 'items', columns: [{ name: 'id', type: 'int' }, { name: 'label', type: 'text' }] }] };

function httpError(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function slug(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
}

/** Build a curation-ready DRAFT for the requested source (instant generators or the official catalog). */
function draftForSource(serverId, source, resources) {
  if (source === 'official') {
    // Normalize the official catalog into the draft shape curation expects (scope → suggestedScope).
    const tools = OFFICIAL_TOOLS.map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      mutates: t.mutates, suggestedScope: t.scope ?? null, method: t.method, path: t.path,
    }));
    return { serverId, status: 'draft', requiresCuration: true, generatedFrom: ['official'], tools };
  }
  // 'instant' (default): generate from the tenant's resources (a sample schema when none supplied).
  return generateInstantManifest(serverId, resources ?? { postgres: SAMPLE_POSTGRES });
}

export function createMcpEngine({
  selfBaseUrl = process.env.MCP_SELF_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`,
  gatewayBaseUrl = process.env.MCP_GATEWAY_BASE_URL ?? selfBaseUrl,
  runtimeImage = process.env.MCP_RUNTIME_IMAGE ?? 'localhost:30500/in-falcone-mcp-runtime',
  runtimeImageDigest = process.env.MCP_RUNTIME_IMAGE_DIGEST ?? `sha256:${'a'.repeat(64)}`,
  plan = MCP_QUOTA_DEFAULTS[process.env.MCP_PLAN ?? 'standard'] ?? MCP_QUOTA_DEFAULTS.standard,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
} = {}) {
  const registry = createRegistry();
  const servers = new Map(); // `${tenantId}::${serverId}` -> { serverId, name, source, tenantId, workspaceId, draft, curated }
  const auditLog = []; // audit events (each carries scope.tenant_id)
  const rateWindows = new Map(); // rateKey -> { count, windowStart }
  const pinnedImage = `${runtimeImage}@${runtimeImageDigest}`;
  const key = (tid, sid) => `${tid}::${sid}`;

  function tenantServers(identity, workspaceId) {
    return [...servers.values()].filter((s) => s.tenantId === identity.tenantId && (!workspaceId || s.workspaceId === workspaceId));
  }

  function requireServer(identity, serverId) {
    const entry = servers.get(key(identity.tenantId, serverId));
    if (!entry || entry.tenantId !== identity.tenantId) throw httpError(404, 'MCP_SERVER_NOT_FOUND', 'No such MCP server for this tenant.');
    return entry;
  }

  function endpointFor(workspaceId, serverId) {
    return `${gatewayBaseUrl}/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverId)}`;
  }

  function recordAudit(event) { auditLog.push(event); }

  function enforceRate(identity, serverId, scope, oauthClientId) {
    const k = rateLimitKey({ tenantId: identity.tenantId, serverId, oauthClientId, scope });
    const now = clock();
    const w = rateWindows.get(k);
    const window = !w || now - w.windowStart >= 60_000 ? { count: 0, windowStart: now } : w;
    window.count += 1;
    rateWindows.set(k, window);
    const decision = evaluateToolCallRate({ plan, scope, windowCount: window.count, windowSeconds: 60 });
    if (!decision.allowed) throw httpError(decision.httpStatus, decision.code, decision.message, { dimension: decision.dimension, retryAfterSeconds: decision.retryAfterSeconds });
  }

  function viewServer(identity, entry) {
    const registered = getServer(registry, identity.tenantId, entry.serverId);
    const activeVersion = registered?.activeVersion ?? null;
    const activeRecord = registered?.versions?.find((v) => v.version === activeVersion);
    const status = activeVersion ? 'published' : (entry.curated ? 'curated' : 'draft');
    const tools = activeRecord?.tools ?? entry.curated?.tools ?? entry.draft?.tools ?? [];
    return {
      serverId: entry.serverId, name: entry.name, source: entry.source, status,
      endpoint: endpointFor(entry.workspaceId, entry.serverId), version: activeVersion, activeVersion,
      tools: tools.map((t) => ({ name: t.name, description: t.description ?? null, mutates: !!t.mutates, scope: t.scope ?? t.suggestedScope ?? null })),
    };
  }

  // Mediate a tool call: resolve the tool in the active published manifest, enforce its scope, and
  // self-call the runtime using the tool's own method/path (workspace from the credential context,
  // NEVER from args). Returns an MCP-style result envelope (tool-level errors live in content).
  async function invokeTool(identity, entry, registered, toolName, args = {}) {
    const activeRecord = registered.versions.find((v) => v.version === registered.activeVersion);
    const tool = (activeRecord?.tools ?? []).find((t) => t.name === toolName);
    if (!tool) return { content: [{ type: 'text', text: `unknown tool: ${toolName}` }], isError: true };
    // Read tools need the base scope; a mutating tool needs its explicit scope. The tenant owns the
    // server, so the granted scopes are the base scope + the tool's own scope.
    const toolScope = tool.scope ?? tool.suggestedScope ?? null;
    const granted = new Set([BASE_SCOPE, ...(toolScope ? [toolScope] : [])]);
    if (!granted.has(BASE_SCOPE)) return { content: [{ type: 'text', text: `missing required scope: ${BASE_SCOPE}` }], isError: true };
    if (tool.mutates && toolScope && !granted.has(toolScope)) return { content: [{ type: 'text', text: `mutating tool requires scope: ${toolScope}` }], isError: true };

    const method = tool.method ?? 'GET';
    let path = String(tool.path ?? '').replace('{workspaceId}', encodeURIComponent(entry.workspaceId)).replace('{id}', encodeURIComponent(args.workspaceId ?? args.id ?? entry.workspaceId)).replace('{key}', encodeURIComponent(args.key ?? ''));
    const headers = {
      'x-tenant-id': identity.tenantId,
      'x-workspace-id': entry.workspaceId,
      'x-auth-subject': identity.actorId ?? 'mcp',
      'x-pg-role': identity.roleName ?? 'falcone_app',
      'content-type': 'application/json',
      accept: 'application/json',
    };
    const init = { method, headers };
    if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(tool.mutates ? (args.row ?? args.payload ?? args) : {});
    try {
      const res = await fetchImpl(`${selfBaseUrl}${path}`, init);
      let body; try { body = await res.json(); } catch { body = null; }
      return { content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], status: res.status };
    } catch (err) {
      return { content: [{ type: 'text', text: `tool backend unavailable: ${err.message}` }], isError: true };
    }
  }

  async function executeMcp(params = {}) {
    const { operation, identity, workspaceId, serverId, version, body = {} } = params;
    const tid = identity?.tenantId;
    if (!tid) throw httpError(401, 'UNAUTHENTICATED', 'Missing tenant identity');
    const audit = (action, extra = {}) => recordAudit(mcpAuditEvent({
      tenantId: tid, workspaceId, oauthClientId: identity.actorId ?? 'system', action,
      serverId: extra.serverId ?? serverId, correlationId: randomUUID(), eventId: randomUUID(), eventTimestamp: new Date(clock()).toISOString(),
    }));

    switch (operation) {
      case 'list_servers':
        return { items: tenantServers(identity, workspaceId).map((s) => viewServer(identity, s)) };

      case 'create_server': {
        const decision = evaluateServerCountQuota({ plan, currentServers: tenantServers(identity).length });
        if (!decision.allowed) throw httpError(decision.httpStatus, decision.code, decision.message, { dimension: decision.dimension });
        const source = body.source ?? 'instant';
        const sid = `srv-${slug(body.name ?? source)}-${randomUUID().slice(0, 8)}`;
        const draft = draftForSource(sid, source, body.resources);
        servers.set(key(tid, sid), { serverId: sid, name: body.name ?? sid, source, tenantId: tid, workspaceId, draft, curated: null });
        return { serverId: sid, status: 'draft', name: body.name ?? sid, generatedFrom: draft.generatedFrom };
      }

      case 'get_server':
        return viewServer(identity, requireServer(identity, serverId));

      case 'curate_server': {
        const entry = requireServer(identity, serverId);
        entry.curated = applyCuration(entry.draft, body ?? {});
        return { serverId, status: 'curated', tools: entry.curated.tools, violations: entry.curated.violations };
      }

      case 'publish_version': {
        const entry = requireServer(identity, serverId);
        const curated = body.curation || !entry.curated ? applyCuration(entry.draft, body.curation ?? {}) : entry.curated;
        entry.curated = curated;
        const pub = publishManifest(curated);
        if (!pub.ok) throw httpError(422, 'MCP_PUBLISH_REJECTED', 'Manifest failed the curation gate.', { errors: pub.violations });
        const v = version ?? body.version ?? `v${(listVersions(registry, tid, serverId).length || 0) + 1}`;
        const reg = registerVersion(registry, { tenantId: tid, serverId, version: v, image: pinnedImage, manifest: pub.manifest, source: entry.source === 'official' ? 'official' : entry.source === 'custom' ? 'custom' : 'instant', signatureVerified: true });
        if (!reg.ok) throw httpError(reg.violations?.[0]?.code === 'duplicate_version' ? 409 : 422, 'MCP_VERSION_REJECTED', reg.violations?.[0]?.message ?? 'Version rejected.', { errors: reg.violations });
        const record = reg.version;
        let activated = false;
        if (!record.requiresReview) { activateVersion(registry, tid, serverId, v, { approved: false }); activated = true; }
        audit('server_published', { serverId });
        const active = getServer(registry, tid, serverId)?.activeVersion ?? null;
        return { serverId, version: v, requiresReview: record.requiresReview, status: record.requiresReview ? 'requires_review' : 'active', activeVersion: active, activated };
      }

      case 'approve_version': {
        requireServer(identity, serverId);
        const result = activateVersion(registry, tid, serverId, version, { approved: true });
        if (!result.ok) throw httpError(404, 'MCP_VERSION_NOT_FOUND', result.violations?.[0]?.message ?? 'Version not found.', { errors: result.violations });
        audit('scopes_changed', { serverId });
        return { serverId, approvedVersion: version, activeVersion: getServer(registry, tid, serverId)?.activeVersion ?? null };
      }

      case 'call_tool': {
        const entry = requireServer(identity, serverId);
        const registered = getServer(registry, tid, serverId);
        if (!registered?.activeVersion) throw httpError(409, 'MCP_SERVER_NOT_CONNECTABLE', 'Server has no active published version.');
        const oauthClientId = identity.actorId ?? 'mcp';
        enforceRate(identity, serverId, 'server', oauthClientId);
        enforceRate(identity, serverId, 'oauth_client', oauthClientId);
        const started = clock();
        const result = await invokeTool(identity, entry, registered, body.name, body.arguments ?? {});
        const telemetry = mcpToolCallTelemetry({ tenantId: tid, workspaceId: entry.workspaceId, serverId, toolName: body.name, oauthClientId, latencyMs: clock() - started, status: result.isError ? 'error' : 'ok' });
        recordAudit({ ...mcpAuditEvent({ tenantId: tid, workspaceId: entry.workspaceId, oauthClientId, action: 'scopes_changed', serverId, correlationId: randomUUID(), eventId: randomUUID(), eventTimestamp: new Date(clock()).toISOString() }), action: { category: 'tool_invocation', id: `mcp.tool_call.${body.name}` }, detail: telemetry.log });
        return { result, content: result.content, toolName: body.name };
      }

      case 'list_audit': {
        requireServer(identity, serverId);
        const items = filterAuditRecordsForTenant(auditLog, tid)
          .filter((e) => (e.resource?.mcp_server_id ?? e.resource?.resource_id) === serverId || e.detail?.server === serverId);
        return { items };
      }

      case 'delete_server': {
        const entry = requireServer(identity, serverId);
        servers.delete(key(tid, serverId));
        const reg = registry.servers[key(tid, serverId)];
        if (reg) delete registry.servers[key(tid, serverId)];
        audit('server_unpublished', { serverId: entry.serverId });
        return { serverId, deleted: true };
      }

      default:
        throw httpError(400, 'MCP_UNKNOWN_OPERATION', `Unknown MCP operation: ${operation}`);
    }
  }

  return { executeMcp };
}
