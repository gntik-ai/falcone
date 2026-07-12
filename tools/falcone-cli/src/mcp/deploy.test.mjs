import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeployRequest, formatDeployResult } from './deploy.mjs';
import { CliError } from '../cli.mjs';

const context = { tenantId: 'ten-a', workspaceId: 'ws-1', token: 'tok_1', apiBaseUrl: 'https://api.test' };

test('buildDeployRequest: workspace-scoped path + bearer auth + image body', () => {
  const req = buildDeployRequest({ context, image: 'reg.example/acme@sha256:abc', name: 'acme' });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://api.test/v1/mcp/workspaces/ws-1/servers');
  assert.equal(req.headers.Authorization, 'Bearer tok_1');
  assert.deepEqual(req.body, { image: 'reg.example/acme@sha256:abc', name: 'acme' });
});

test('buildDeployRequest: path comes from the credential workspace, not from args (no cross-tenant)', () => {
  // even if the caller passes a workspace-looking value in name/image, the path uses context.workspaceId
  const req = buildDeployRequest({ context, source: './srv', name: 'ws-EVIL' });
  assert.equal(req.url, 'https://api.test/v1/mcp/workspaces/ws-1/servers');
  assert.ok(!req.url.includes('EVIL'));
  assert.deepEqual(req.body, { source: './srv', name: 'ws-EVIL' });
});

test('buildDeployRequest: requires exactly one of image/source; requires a workspace', () => {
  assert.throws(() => buildDeployRequest({ context }), (e) => e instanceof CliError && e.exitCode === 2);
  assert.throws(() => buildDeployRequest({ context, image: 'i', source: 's' }), /only one/);
  assert.throws(() => buildDeployRequest({ context: { ...context, workspaceId: null }, image: 'i' }), /workspace is required/);
});

test('formatDeployResult: prints the endpoint when available, else a pending hint', () => {
  assert.match(formatDeployResult({ endpoint: 'https://gw/x' }), /Endpoint: https:\/\/gw\/x/);
  assert.match(formatDeployResult({ endpointUrl: 'https://gw/y' }), /https:\/\/gw\/y/);
  assert.match(formatDeployResult({}), /not yet available/);
});
