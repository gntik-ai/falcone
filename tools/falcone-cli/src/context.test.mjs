import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContext, authHeaders, requireWorkspace } from './context.mjs';
import { CliError } from './cli.mjs';

const env = { FALCONE_TOKEN: 'tok_1', FALCONE_TENANT: 'ten-a', FALCONE_WORKSPACE: 'ws-1', FALCONE_API_URL: 'https://api.test' };

test('resolveContext: derives tenant/workspace/token from credentials + flags', () => {
  const ctx = resolveContext({ env, flags: {} });
  assert.equal(ctx.tenantId, 'ten-a');
  assert.equal(ctx.workspaceId, 'ws-1');
  assert.equal(ctx.token, 'tok_1');
  assert.equal(ctx.apiBaseUrl, 'https://api.test');
  // --workspace flag overrides the env workspace (within the same tenant)
  assert.equal(resolveContext({ env, flags: { workspace: 'ws-2' } }).workspaceId, 'ws-2');
});

test('resolveContext: requires authentication and a tenant', () => {
  assert.throws(() => resolveContext({ env: {}, flags: {} }), (e) => e instanceof CliError && e.exitCode === 3);
  assert.throws(() => resolveContext({ env: { FALCONE_TOKEN: 't' }, flags: {} }), /No tenant/);
});

test('resolveContext: a --tenant other than the credential tenant is refused (no cross-tenant)', () => {
  assert.throws(
    () => resolveContext({ env, flags: { tenant: 'ten-b' } }),
    (e) => e instanceof CliError && e.exitCode === 4 && /Cross-tenant access refused/.test(e.message)
  );
  // echoing the same tenant is fine
  assert.equal(resolveContext({ env, flags: { tenant: 'ten-a' } }).tenantId, 'ten-a');
});

test('authHeaders + requireWorkspace', () => {
  const ctx = resolveContext({ env, flags: {} });
  assert.deepEqual(authHeaders(ctx), { Authorization: 'Bearer tok_1' });
  assert.equal(requireWorkspace(ctx), 'ws-1');
  assert.throws(() => requireWorkspace({ workspaceId: null }), /workspace is required/);
});
