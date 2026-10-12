import test from 'node:test';
import assert from 'node:assert/strict';
import { mintExecutionToken, validateExecutionToken } from '../../apps/control-plane-executor/src/runtime/execution-token.mjs';

// Separate from the workflow-ID suite so the signing boundary runs without infra dependencies.
async function withEnv(mode, secret, fn) {
  const saved = { NODE_ENV: process.env.NODE_ENV, FLOW_EXECUTION_TOKEN_SECRET: process.env.FLOW_EXECUTION_TOKEN_SECRET };
  process.env.NODE_ENV = mode;
  if (secret === undefined) delete process.env.FLOW_EXECUTION_TOKEN_SECRET;
  else process.env.FLOW_EXECUTION_TOKEN_SECRET = secret;
  try { return await fn(); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('production refuses minting with an unset, empty, or shorter-than-32-byte secret', async () => {
  for (const secret of [undefined, '', 'short', 'x'.repeat(31)]) {
    await withEnv('production', secret, async () => {
      await assert.rejects(() => mintExecutionToken('tenant_A', 'ws_A'), (err) =>
        err.code === 'EXECUTION_TOKEN_SECRET_UNCONFIGURED' && err.statusCode === 503 &&
        err.message === 'FLOW_EXECUTION_TOKEN_SECRET is not configured');
    });
  }
});

test('production validates the configured key and rejects tokens signed with the dev key', async () => {
  const forged = await withEnv('test', undefined, () => mintExecutionToken('tenant_A', 'ws_A'));
  await withEnv('production', 'x'.repeat(32), async () => {
    await assert.rejects(() => validateExecutionToken(forged, 'tenant_A', 'ws_A'),
      (err) => err.code === 'EXECUTION_TOKEN_INVALID');
    const token = await mintExecutionToken('tenant_A', 'ws_A');
    assert.equal((await validateExecutionToken(token, 'tenant_A', 'ws_A')).tenantId, 'tenant_A');
  });
  await withEnv('production', undefined, async () => {
    await assert.rejects(() => validateExecutionToken(forged, 'tenant_A', 'ws_A'),
      (err) => err.code === 'EXECUTION_TOKEN_SECRET_UNCONFIGURED');
  });
});

test('non-production retains the dev round-trip and production measures the minimum in UTF-8 bytes', async () => {
  for (const mode of ['test', 'development', 'production']) {
    await withEnv(mode, mode === 'production' ? 'é'.repeat(16) : undefined, async () => {
      const token = await mintExecutionToken('tenant_A', 'ws_A');
      assert.equal((await validateExecutionToken(token, 'tenant_A', 'ws_A')).workspaceId, 'ws_A');
    });
  }
});
