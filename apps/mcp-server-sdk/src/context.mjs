/**
 * Tenant-scoped Falcone context for MCP tools (change: add-mcp-server-sdk, #401; epic #386).
 *
 * `createFalconeContext` builds the `ctx` injected into every tool handler: `db`, `storage`,
 * `functions`, `events` clients pre-bound to the tenant/workspace resolved from the verified
 * credential. Every client call attaches the bound tenant/workspace and STRIPS any tenant/workspace
 * the caller tries to pass — there is no API to widen or change the scope, so a tool cannot escape
 * its tenant (ADR-2; the executor applies RLS from the attached tenant). Stateless: a fresh context
 * is built per invocation from the request's credential — no per-connection state.
 *
 * `call` is the injected transport (the host wires it to the executor/data plane); the SDK only
 * guarantees the scope is always present and authoritative.
 */

/** Build a request with the bound tenant/workspace forced on top of any caller-supplied params. */
function scoped(binding, request) {
  const { tenantId: _t, workspaceId: _w, ...rest } = request ?? {};
  return { ...rest, tenantId: binding.tenantId, workspaceId: binding.workspaceId };
}

/**
 * @param {{ tenantId:string, workspaceId:string, call:(req:object)=>Promise<any> }} binding
 * @returns {object} a frozen ctx with tenant-scoped clients
 */
export function createFalconeContext({ tenantId, workspaceId, call } = {}) {
  if (!tenantId) throw new Error('createFalconeContext requires a credential-derived tenantId.');
  if (typeof call !== 'function') throw new Error('createFalconeContext requires a call transport.');
  const binding = { tenantId, workspaceId: workspaceId ?? null };
  const send = (capability, op, params) => call(scoped(binding, { capability, op, ...params }));

  const db = Object.freeze({
    query: (sql, values = []) => send('postgres', 'query', { sql, values }),
    select: (table, filter = {}) => send('postgres', 'select', { table, filter }),
    insert: (table, row = {}) => send('postgres', 'insert', { table, row }),
    update: (table, filter, patch) => send('postgres', 'update', { table, filter, patch }),
    delete: (table, filter) => send('postgres', 'delete', { table, filter }),
  });
  const storage = Object.freeze({
    get: (key) => send('storage', 'get', { key }),
    put: (key, body, options = {}) => send('storage', 'put', { key, body, options }),
    delete: (key) => send('storage', 'delete', { key }),
    list: (prefix = '') => send('storage', 'list', { prefix }),
  });
  const functions = Object.freeze({
    invoke: (name, payload = {}) => send('functions', 'invoke', { name, payload }),
  });
  const events = Object.freeze({
    publish: (topic, event = {}) => send('events', 'publish', { topic, event }),
  });

  return Object.freeze({ tenantId: binding.tenantId, workspaceId: binding.workspaceId, db, storage, functions, events });
}
