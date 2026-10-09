import { kcAdmin, KEYCLOAK_ADMIN_SAFE_MESSAGE } from './kc-admin.mjs';
import { resolveWorkspaceForManage, kcBackedErr } from './workspace-iam-context.mjs';
import { isIP } from 'node:net';

const err = (code = 'VALIDATION_ERROR') => ({ statusCode: 400, body: { code, message: code === 'UNSUPPORTED_FIELD' ? 'permissions are unsupported' : 'Invalid IAM client configuration' } });
const unique = (items) => [...new Set(items)].sort();
const pendingClients = new Map();
async function serializeClient(key, task) {
  const previous = pendingClients.get(key);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  pendingClients.set(key, pending);
  if (previous) await previous;
  try { return await task(); }
  finally {
    release();
    if (pendingClients.get(key) === pending) pendingClients.delete(key);
  }
}
function matchesClient(client, config, workspaceId) {
  const attr = (key) => client?.attributes?.[key];
  const same = (actual, expected) => Array.isArray(actual)
    && JSON.stringify(unique(actual)) === JSON.stringify(unique(expected));
  return typeof client?.id === 'string' && !!client.id && client.clientId === config.clientId
    && client.enabled === true && client.protocol === 'openid-connect'
    && client.publicClient === (config.clientType === 'public')
    && client.standardFlowEnabled === (config.clientType !== 'service_account')
    && client.serviceAccountsEnabled === (config.clientType === 'service_account')
    && client.directAccessGrantsEnabled === false && client.implicitFlowEnabled !== true && client.bearerOnly !== true
    && attr('in-falcone.kind') === 'workspace-iam-client' && attr('in-falcone.workspace-id') === workspaceId
    && (config.clientType !== 'public' || attr('pkce.code.challenge.method') === 'S256')
    && same(client.redirectUris, config.redirectUris) && same(client.webOrigins, config.webOrigins)
    && same(client.defaultClientScopes, config.defaultClientScopes) && same(client.optionalClientScopes, []);
}
const clientExists = () => ({ statusCode: 409, body: { code: 'IAM_CLIENT_EXISTS', message: 'Client ID already exists with a different configuration or workspace' } });
function safeUri(value, origin = false) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\s\\#*]/.test(value)) return false;
  try {
    if (decodeURIComponent(value).includes('*')) return false;
    const url = new URL(value);
    const host = url.hostname;
    const loopback = host === 'localhost' || host === '[::1]' || (isIP(host) === 4 && host.startsWith('127.'));
    return !!host && !value.split('/')[2].includes('@') && !url.username && !url.password
      && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
      && (!origin || (url.pathname === '/' && !url.search));
  } catch { return false; }
}
function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return err();
  if (body.permissions !== undefined && (!Array.isArray(body.permissions) || body.permissions.length)) return err('UNSUPPORTED_FIELD');
  if (['realm', 'realmId', 'tenantId'].some((key) => Object.hasOwn(body, key))) return err();
  if (typeof body.clientId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.clientId)) return err();
  if (!['public', 'confidential', 'service_account'].includes(body.clientType)) return err();
  const redirects = body.redirectUris ?? [];
  const origins = body.webOrigins ?? [];
  const scopes = body.scopes ?? [];
  if (!Array.isArray(redirects) || !Array.isArray(origins) || !Array.isArray(scopes)
    || redirects.some((uri) => !safeUri(uri)) || origins.some((uri) => !safeUri(uri, true))
    || scopes.some((scope) => typeof scope !== 'string' || !scope)) return err();
  if (body.clientType !== 'service_account' && !redirects.length) return err();
  if (body.clientType === 'service_account' && (redirects.length || origins.length)) return err();
  return null;
}
function redactedRequest(body = {}) {
  const redactUris = (items, origin) => Array.isArray(items) ? items.map((value) => {
    if (!safeUri(value, origin)) return '<REDACTED>';
    const url = new URL(value);
    // Query values can contain credentials; retain only the target location.
    return `${url.origin}${url.pathname}${url.search ? '?<REDACTED>' : ''}`;
  }) : [];
  return {
    clientId: typeof body?.clientId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.clientId) ? body.clientId : '<REDACTED>',
    clientType: ['public', 'confidential', 'service_account'].includes(body?.clientType) ? body.clientType : '<REDACTED>',
    redirectUris: redactUris(body?.redirectUris, false), webOrigins: redactUris(body?.webOrigins, true),
    scopes: Array.isArray(body?.scopes) ? body.scopes.map((s) => typeof s === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(s) ? s : '<REDACTED>') : [],
  };
}

// This endpoint returns only a verified client identity; Keycloak representations
// can contain secrets and must never be used as response or audit bodies.
export async function createWorkspaceIamClient(ctx) {
  let ws;
  let realizedId = null;
  let compensation = 'none';
  const finish = (result) => ({
    ...result,
    auditScope: { tenantId: ws?.tenant_id ?? ctx.identity?.tenantId ?? null, workspaceId: ws?.id ?? ctx.params.workspaceId },
    iamClientAudit: { requested: redactedRequest(ctx.body), iamClientId: realizedId, compensation, code: result.body?.code ?? null },
  });
  if (!['superadmin', 'tenant_owner', 'tenant_admin'].includes(ctx.identity?.actorType)) {
    return finish({ statusCode: 403, body: { code: 'FORBIDDEN', message: 'requires superadmin or tenant owner/admin' } });
  }
  const r = await resolveWorkspaceForManage(ctx);
  ws = r.ws;
  if (r.error) return finish(r.error);
  const invalid = validateBody(ctx.body);
  if (invalid) return finish(invalid);
  const kc = ctx.kcAdmin ?? kcAdmin;
  const { clientId, clientType } = ctx.body;
  const redirectUris = unique(ctx.body.redirectUris ?? []);
  const webOrigins = unique(ctx.body.webOrigins ?? []);
  const scopes = unique(ctx.body.scopes ?? []).filter((scope) => scope !== 'openid');
  const result = await serializeClient(JSON.stringify([r.realm, clientId]), async () => {
    let createdId;
    try {
      const offered = await kc.listClientScopes(r.realm);
      if (scopes.some((scope) => !offered.some((entry) => entry.name === scope))) return err();
      const configuration = {
        clientId, clientType, redirectUris, webOrigins,
        authenticationFlows: ['oidc_authorization_code_pkce'],
        standardFlowEnabled: clientType !== 'service_account', serviceAccountsEnabled: clientType === 'service_account',
        defaultClientScopes: scopes, optionalClientScopes: [],
        attributes: { 'in-falcone.kind': 'workspace-iam-client', 'in-falcone.workspace-id': r.ws.id },
      };
      const responseBody = (id) => ({ iamClientId: id, clientId, clientType, realm: r.realm, workspaceId: r.ws.id });
      const found = await kc.findClient(r.realm, clientId);
      const existing = found ? await kc.getClient(r.realm, found.id) : null;
      realizedId = existing?.id ?? null;
      if (existing) return matchesClient(existing, configuration, r.ws.id)
        ? { statusCode: 200, body: responseBody(existing.id), headers: { 'Cache-Control': 'no-store' } }
        : clientExists();
      try {
        createdId = clientType === 'public'
          ? await kc.createOidcAppClient(r.realm, configuration)
          : await kc.createConfidentialClient(r.realm, configuration);
      } catch (error) {
        // Keycloak enforces clientId uniqueness across control-plane replicas.
        // A losing request owns no client and must never fetch the winner's secret.
        if (Number(error?.kcStatus ?? error?.statusCode) !== 409) throw error;
        const winner = await kc.findClient(r.realm, clientId);
        if (!winner?.id) throw new Error(KEYCLOAK_ADMIN_SAFE_MESSAGE);
        const realized = await kc.getClient(r.realm, winner.id);
        realizedId = realized?.id ?? null;
        return matchesClient(realized, configuration, r.ws.id)
          ? { statusCode: 200, body: responseBody(realized.id), headers: { 'Cache-Control': 'no-store' } }
          : clientExists();
      }
      realizedId = createdId ?? null;
      const client = createdId ? await kc.getClient(r.realm, createdId) : null;
      if (!createdId || client?.id !== createdId || !matchesClient(client, configuration, r.ws.id)) throw new Error(KEYCLOAK_ADMIN_SAFE_MESSAGE);
      const body = responseBody(createdId);
      if (clientType !== 'public') {
        const secret = await kc.getClientSecret(r.realm, createdId);
        if (typeof secret !== 'string' || !secret) throw new Error(KEYCLOAK_ADMIN_SAFE_MESSAGE);
        body.clientSecret = secret;
      }
      return { statusCode: 201, body, headers: { 'Cache-Control': 'no-store' } };
    } catch (error) {
      if (createdId) {
        try { await kc.deleteClient(r.realm, createdId); compensation = 'deleted'; }
        catch { compensation = 'failed'; }
      }
      // Upstream 4xx and arbitrary transport messages are provider failures here,
      // never caller validation errors. Do not expose their diagnostic material.
      return kcBackedErr(new Error(KEYCLOAK_ADMIN_SAFE_MESSAGE), 'IAM_CREATE_CLIENT_FAILED');
    }
  });
  return finish(result);
}
