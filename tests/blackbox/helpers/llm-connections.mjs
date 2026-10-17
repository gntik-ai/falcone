import { request as httpRequest } from '../../helpers/http-request.mjs';
import { createControlPlaneServer } from '../../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createLlmExecutor, localMockLlmBackend } from '../../../apps/control-plane-executor/src/runtime/llm-executor.mjs';

export const config = { providerType: 'openai', endpoint: 'https://example.test/chat', allowedModels: ['model-a'], defaultModel: 'model-a', secretRef: { name: 'BYOK_TEST' } };
export const collection = '/v1/workspaces/shared/llm-providers';
export const singular = '/v1/workspaces/shared/llm-provider';
export const headers = { 'content-type': 'application/json', 'x-tenant-id': 'tenant-a', 'x-auth-subject': 'test-admin', 'x-actor-roles': 'tenant_admin', 'x-workspace-id': 'shared' };
export async function withLlmServer(fn) {
  const registry = createConnectionRegistry({ resolveConnection: () => { throw new Error('Unexpected data-plane access'); } });
  const llmExecutor = createLlmExecutor({ endpointResolver: async () => ['93.184.216.34'], secretResolver: () => 'test-placeholder', backendFactory: () => localMockLlmBackend() });
  const apiKeyStore = { async verifyKey() { return { tenantId: 'tenant-a', workspaceId: 'shared', actorId: 'apikey:test', dbRole: 'falcone_service', scopes: ['data:read', 'data:write', 'ddl:write'], roles: ['tenant_admin'] }; } };
  const server = createControlPlaneServer({ registry, llmExecutor, apiKeyStore, logger: { error() {} } });
  async function request(method, path = collection, body, identity = {}) {
    return httpRequest(server, { method, path, headers: { ...headers, ...identity }, body: JSON.stringify(body ?? {}) });
  }
  try { await fn(request); } finally { server.close(); await registry.end(); }
}
