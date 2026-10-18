import { request as httpRequest } from '../../helpers/http-request.mjs';
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createEmbeddingExecutor, createEmbeddingMappingStore } from '../../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';

export const config = { providerType: 'openai', endpoint: 'https://example.test/chat', model: 'model-a', dimension: 3, secretRef: { name: 'BYOK_TEST' } };
export const collection = '/v1/workspaces/shared/embedding-providers';
export const singular = '/v1/workspaces/shared/embedding-provider';
export const headers = { 'content-type': 'application/json', 'x-tenant-id': 'tenant-a', 'x-auth-subject': 'test-admin', 'x-actor-roles': 'tenant_admin', 'x-workspace-id': 'shared' };
export async function withEmbeddingServer(fn, options = {}) {
  const registry = options.registry ?? createConnectionRegistry({ resolveConnection: () => { throw new Error('Unexpected data-plane access'); } });
  const embeddingExecutor = createEmbeddingExecutor({ endpointResolver: async () => ['93.184.216.34'], secretResolver: () => 'test-placeholder', ...options });
  const apiKeyStore = { async verifyKey() { return { tenantId: 'tenant-a', workspaceId: 'shared', actorId: 'apikey:test', dbRole: 'falcone_service', scopes: ['data:read', 'data:write', 'ddl:write'], roles: ['tenant_admin'] }; } };
  const mappingStore = options.mappingStore ?? createEmbeddingMappingStore();
  const server = createControlPlaneServer({ registry, embeddingExecutor, mappingStore, apiKeyStore, logger: { error() {} } });
  async function request(method, path = collection, body, identity = {}) {
    return httpRequest(server, { method, path, headers: { ...headers, ...identity }, body: JSON.stringify(body ?? {}) });
  }
  try { await fn(request, { embeddingExecutor, mappingStore }); } finally { server.close(); await registry.end(); }
}

// Database boundary: a vector-capable docs table and deterministic row results.
export function dataRegistry() {
  const client = { async query(sql) {
    if (/pg_available_extensions/.test(sql)) return { rows: [{ name: 'vector' }] };
    if (/information_schema.columns/.test(sql)) return { rows: [
      { column_name: 'id', data_type: 'uuid', udt_name: 'uuid' },
      { column_name: 'body', data_type: 'text', udt_name: 'text' },
      { column_name: 'embedding', data_type: 'USER-DEFINED', udt_name: 'vector' },
    ] };
    if (/indisprimary/.test(sql)) return { rows: [{ column_name: 'id' }] };
    if (/atttypmod/.test(sql)) return { rows: [{ typmod: 3 }] };
    if (/set_config/.test(sql)) return { rows: [] };
    return { rowCount: 1, rows: [{ id: 'doc-1', body: 'hello', embedding: '[1,2,3]' }] };
  } };
  return {
    async withWorkspaceClient(_workspaceId, _identity, fn) { return fn(client); },
    async withAdminClient(_workspaceId, fn) { return fn(client); },
    async end() {},
  };
}
export const mappingPath = '/v1/postgres/workspaces/shared/data/appdb/schemas/public/tables/docs/embedding-mapping';
export const mapping = { sourceColumn: 'body', targetColumn: 'embedding' };

export function serverFetch(server) {
  return async (path, init = {}) => {
    const response = await httpRequest(server, { method: init.method ?? 'GET', path, headers: init.headers, body: init.body ?? '{}' });
    return new Response(JSON.stringify(response.body), { status: response.status, headers: response.headers });
  };
}
