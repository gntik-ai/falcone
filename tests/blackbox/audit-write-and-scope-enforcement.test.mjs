/**
 * Black-box tests for the audit WRITER + scope-enforcement denial writer
 * (add-audit-write-and-scope-enforcement-store, #557, epic #541).
 *
 * Live 2-tenant E2E (2026-06-18): after performing real actions (create
 * users/workspaces/etc.) the audit-records query returned ZERO entries — no
 * action audit records were written, and none carried correlation ids; the
 * scope-enforcement audit query did not surface any denials.
 *
 * This suite drives the PUBLIC surfaces only:
 *   - the kind control-plane audit store (recordAuditEvent / queryAuditEvents),
 *   - the metrics audit-records read handler (METRICS_HANDLERS.metricsTenantAudit
 *     / metricsWorkspaceAudit), which must surface written records tenant-scoped,
 *   - the scope-enforcement denial writer (recordScopeDenial) feeding the product
 *     scope-enforcement-audit-query action.
 *
 * bbx-audit-write-01: a recorded action surfaces in the tenant audit-records read WITH its correlation id
 * bbx-audit-write-02: audit-records reads are own-tenant scoped (tenant B never sees tenant A's records)
 * bbx-audit-write-03: a workspace action surfaces in the workspace audit-records read
 * bbx-audit-write-04: the dispatch-level writer records a mutating local action with the request correlation id
 * bbx-audit-write-05: a recorded scope-enforcement denial is returned by the scope-enforcement audit query (no 500)
 * bbx-audit-write-06: scope-enforcement denials are tenant-scoped (a tenant owner sees only its own)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS_HANDLERS } from '../../deploy/kind/control-plane/metrics-handlers.mjs';
import { recordAuditEvent, queryAuditEvents } from '../../deploy/kind/control-plane/audit-store.mjs';
import { recordScopeDenial, auditEventForRoute } from '../../deploy/kind/control-plane/audit-writer.mjs';
import { main as scopeAuditQuery } from '../../services/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const WS_A = '33333333-3333-3333-3333-333333333333';

const WS_A_ROW = { id: WS_A, tenant_id: TENANT_A, slug: 'app-staging', display_name: 'App Staging', status: 'active', environment: 'staging' };

// In-memory pool that emulates the plan_audit_events + scope_enforcement_denials
// tables. It honours the WHERE tenant_id / workspace + ORDER BY / column shape the
// real handlers use, so we exercise tenant-scoping through the public read path.
function memPool() {
  const audit = [];
  const denials = [];
  const query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ');
    // #644: recordAuditEvent now runs in a per-tenant transaction (advisory lock +
    // prev-hash read + chained INSERT). The stub honours those statements.
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s) || s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes('SELECT row_hash FROM plan_audit_events')) {
      const tenantId = params[0];
      const rows = audit.filter((r) => r.tenant_id === tenantId);
      const last = rows[rows.length - 1];
      return { rows: last ? [{ row_hash: last.row_hash }] : [] };
    }
    if (s.includes('INSERT INTO plan_audit_events')) {
      // #644 INSERT params: [id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash]
      const [id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash] = params;
      const parsedNew = new_state ? JSON.parse(new_state) : {};
      const row = {
        id, action_type, actor_id, tenant_id,
        workspace_id: parsedNew.workspaceId ?? null,
        previous_state: previous_state ? JSON.parse(previous_state) : null,
        new_state: parsedNew, outcome, correlation_id: correlation_id ?? null,
        created_at, prev_hash, row_hash
      };
      audit.push(row);
      return { rows: [row] };
    }
    if (s.includes('FROM plan_audit_events')) {
      // tenant_id is always the first filter param; workspace_id (when present) the second.
      const tenantId = params[0];
      const workspaceId = s.includes('workspace_id =') ? params[1] : null;
      let rows = audit.filter((r) => r.tenant_id === tenantId);
      if (workspaceId) rows = rows.filter((r) => r.workspace_id === workspaceId);
      rows = rows.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { rows };
    }
    if (s.includes('FROM workspaces')) {
      return { rows: params[0] === WS_A ? [WS_A_ROW] : [] };
    }
    if (s.includes('INSERT INTO scope_enforcement_denials')) {
      const row = {
        id: params[0], tenant_id: params[1], workspace_id: params[2], actor_id: params[3], actor_type: params[4],
        denial_type: params[5], http_method: params[6], request_path: params[7], correlation_id: params[14], denied_at: params[15]
      };
      // honour ON CONFLICT (correlation_id, denied_at) DO NOTHING
      if (denials.some((d) => d.correlation_id === row.correlation_id && d.denied_at === row.denied_at)) return { rows: [] };
      denials.push(row);
      return { rows: [row] };
    }
    if (s.includes('FROM scope_enforcement_denials')) {
      const tenantId = s.includes('tenant_id = $3') ? params[2] : null;
      let rows = denials.filter((d) => !tenantId || d.tenant_id === tenantId);
      if (s.includes('COUNT(*)')) return { rows: [{ total: rows.length }] };
      return { rows };
    }
    return { rows: [] };
  };
  const client = { query, release() {} };
  return { query, connect: async () => client, _audit: audit, _denials: denials };
}

const IDENTITY_A = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_B = { sub: 'user-b', tenantId: TENANT_B, workspaceId: null, actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, workspaceId: null, actorType: 'superadmin', roles: ['superadmin'], scopes: [] };

function metricsCtx(pool, identity, params = {}) {
  return { pool, params, query: {}, body: {}, identity, callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId } };
}

test('bbx-audit-write-01: a recorded action surfaces in the tenant audit-records read WITH its correlation id', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, {
    actionType: 'tenant.user.create', actorId: 'user-a', tenantId: TENANT_A,
    newState: { username: 'alice' }, correlationId: 'corr-aaa'
  });
  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 1, `expected 1 audit item, got ${JSON.stringify(r.body.items)}`);
  const item = r.body.items[0];
  assert.equal(item.correlationId, 'corr-aaa', `correlationId missing: ${JSON.stringify(item)}`);
  assert.equal(item.action?.actionId ?? item.actionType, 'tenant.user.create');
});

test('bbx-audit-write-02: audit-records reads are own-tenant scoped (B never sees A)', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, { actionType: 'tenant.create', actorId: 'sa', tenantId: TENANT_A, newState: {}, correlationId: 'corr-a' });
  // Tenant B reading its OWN tenant sees nothing of A.
  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_B, { tenantId: TENANT_B }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 0, `tenant B leaked A's records: ${JSON.stringify(r.body.items)}`);
  // Tenant B reading tenant A's scope is forbidden at the guard.
  const cross = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_B, { tenantId: TENANT_A }));
  assert.equal(cross.statusCode, 403, JSON.stringify(cross.body));
});

test('bbx-audit-write-03: a workspace action surfaces in the workspace audit-records read', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, {
    actionType: 'workspace.create', actorId: 'user-a', tenantId: TENANT_A, workspaceId: WS_A,
    newState: { slug: 'app-staging' }, correlationId: 'corr-ws'
  });
  // an unrelated tenant-only event that must NOT appear in the workspace read
  await recordAuditEvent(pool, { actionType: 'tenant.create', actorId: 'sa', tenantId: TENANT_A, newState: {}, correlationId: 'corr-t' });
  const r = await METRICS_HANDLERS.metricsWorkspaceAudit(metricsCtx(pool, IDENTITY_A, { workspaceId: WS_A }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 1, `expected only the workspace event, got ${JSON.stringify(r.body.items)}`);
  assert.equal(r.body.items[0].correlationId, 'corr-ws');
});

test('bbx-audit-write-04: the dispatch-level writer records a mutating local action with the request correlation id', async () => {
  const pool = memPool();
  // auditEventForRoute derives the audit descriptor a mutating route produces; null
  // for non-auditable (read) routes so the writer no-ops on GETs.
  const desc = auditEventForRoute(
    { method: 'POST', path: '/v1/tenants/{tenantId}/users', localHandler: 'createTenantUser' },
    { params: { tenantId: TENANT_A }, identity: IDENTITY_A, body: { username: 'bob' } },
    { statusCode: 201, body: { userId: 'u1', username: 'bob' } }
  );
  assert.ok(desc, 'a successful mutating action must yield an audit descriptor');
  await recordAuditEvent(pool, { ...desc, correlationId: 'corr-dispatch' });
  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }));
  assert.equal(r.body.items.length, 1, JSON.stringify(r.body.items));
  assert.equal(r.body.items[0].correlationId, 'corr-dispatch');

  // a GET (read) route is NOT auditable
  const none = auditEventForRoute(
    { method: 'GET', path: '/v1/tenants/{tenantId}/users', localHandler: 'listTenantUsers' },
    { params: { tenantId: TENANT_A }, identity: IDENTITY_A, body: {} },
    { statusCode: 200, body: { items: [] } }
  );
  assert.equal(none, null, 'read routes must not produce audit records');

  // a FAILED mutation (>=400) IS now recorded (#644), distinguished by outcome — not dropped.
  const failed = auditEventForRoute(
    { method: 'POST', path: '/v1/tenants/{tenantId}/users', localHandler: 'createTenantUser' },
    { params: { tenantId: TENANT_A }, identity: IDENTITY_A, body: {} },
    { statusCode: 400, body: { code: 'VALIDATION_ERROR' } }
  );
  assert.ok(failed, 'failed mutations are now audited (#644)');
  assert.equal(failed.outcome, 'failed', 'recorded with outcome=failed, not silently dropped');
});

test('bbx-audit-write-05: a recorded scope-enforcement denial is returned by the scope-enforcement audit query (no 500)', async () => {
  const pool = memPool();
  await recordScopeDenial(pool, {
    tenantId: TENANT_A, workspaceId: WS_A, actorId: 'user-a', actorType: 'user',
    denialType: 'SCOPE_INSUFFICIENT', httpMethod: 'POST', requestPath: '/v1/functions/1/deploy',
    requiredScopes: ['functions:deploy'], presentedScopes: [], missingScopes: ['functions:deploy'],
    correlationId: 'corr-denial'
  });
  const from = new Date(Date.now() - 3600_000).toISOString();
  const to = new Date(Date.now() + 3600_000).toISOString();
  const res = await scopeAuditQuery(
    { from, to, callerContext: { actor: { type: 'tenant_owner' }, tenantId: TENANT_A } },
    { db: pool }
  );
  assert.equal(res.statusCode, 200, `scope-enforcement audit must not 500: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.denials.length, 1, JSON.stringify(res.body.denials));
  assert.equal(res.body.denials[0].correlation_id, 'corr-denial');
  assert.equal(res.body.denials[0].tenant_id, TENANT_A);
});

test('bbx-audit-write-06: scope-enforcement denials are tenant-scoped (owner sees only its own)', async () => {
  const pool = memPool();
  await recordScopeDenial(pool, { tenantId: TENANT_A, actorId: 'a', actorType: 'user', denialType: 'SCOPE_INSUFFICIENT', httpMethod: 'GET', requestPath: '/v1/db/collections', correlationId: 'corr-a' });
  await recordScopeDenial(pool, { tenantId: TENANT_B, actorId: 'b', actorType: 'user', denialType: 'CONFIG_ERROR', httpMethod: 'GET', requestPath: '/v1/db/collections', correlationId: 'corr-b' });
  const from = new Date(Date.now() - 3600_000).toISOString();
  const to = new Date(Date.now() + 3600_000).toISOString();
  const res = await scopeAuditQuery(
    { from, to, callerContext: { actor: { type: 'tenant_owner' }, tenantId: TENANT_A } },
    { db: pool }
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.denials.length, 1, `tenant A must see only its own denial: ${JSON.stringify(res.body.denials)}`);
  assert.equal(res.body.denials[0].tenant_id, TENANT_A);
});
