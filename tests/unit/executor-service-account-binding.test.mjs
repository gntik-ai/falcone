import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { deriveIdentityFromClaims } from '../../apps/control-plane-executor/src/runtime/jwt-verify.mjs';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { createLlmExecutor } from '../../apps/control-plane-executor/src/runtime/llm-executor.mjs';
import { createEmbeddingExecutor } from '../../apps/control-plane-executor/src/runtime/embedding-executor.mjs';
import { request } from '../helpers/http-request.mjs';

const W = 'fixture-workspace';
const TENANT = 'fixture-tenant';

test('verified SA claims cannot administer its workspace or access another workspace API keys', async () => {
  const server = createControlPlaneServer({ registry: {},
    apiKeyStore: createApiKeyStore({ pool: { query: async () => assert.fail('SA must not reach API-key storage') } }),
    llmExecutor: createLlmExecutor(), embeddingExecutor: createEmbeddingExecutor(),
    resolveWorkspaceTenant: async () => TENANT,
    jwtVerifier: { verify: async (_token, pathWorkspaceId) => deriveIdentityFromClaims({
      tenant_id: TENANT, sub: 'service-account-sa-worker',
      realm_access: { roles: ['workspace_service_account'] }, workspace_id: W,
    }, pathWorkspaceId) },
    logger: { error() {} },
  });
  const routes = [
    ['POST', `/v1/workspaces/${W}/api-keys`],
    ['DELETE', `/v1/workspaces/${W}/api-keys/fixture-key`],
    ['PUT', `/v1/workspaces/${W}/llm-provider`],
    ['DELETE', `/v1/workspaces/${W}/llm-provider`],
    ['PUT', `/v1/workspaces/${W}/embedding-provider`],
    ['DELETE', `/v1/workspaces/${W}/embedding-provider`],
    ['GET', `/v1/workspaces/${W}/api-keys`],
    ['GET', '/v1/workspaces/OTHER/api-keys'],
  ];
  for (const [method, path] of routes) {
    const result = await request(server, { method, path, headers: { authorization: 'Bearer fixture' },
      body: JSON.stringify({ providerType: 'mock', keyType: 'anon' }) });
    assert.equal(result.status, 403, `${method} ${path}`);
    assert.equal(result.body.code, 'FORBIDDEN');
  }
});
