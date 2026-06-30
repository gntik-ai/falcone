// Regression coverage for issue #794: the console MCP detail and Playground calls must target
// served, workspace-scoped MCP routes and the legacy gateway allow-list must not advertise
// unscoped /v1/mcp/servers/{serverId} routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const catalog = JSON.parse(readFileSync(resolve(REPO, 'services/gateway-config/public-route-catalog.json'), 'utf8'));

function entry(method, path) {
  return catalog.find((route) => route.method === method && route.path === path);
}

test('MCP detail and playground routes are advertised as workspace-scoped served paths', () => {
  assert.equal(
    entry('GET', '/v1/mcp/workspaces/{workspaceId}/servers/{serverId}')?.privilege_domain,
    'structural_admin',
  );
  assert.equal(
    entry('POST', '/v1/mcp/workspaces/{workspaceId}/servers/{serverId}/tool-calls')?.privilege_domain,
    'data_access',
  );
});

test('MCP route catalog does not advertise the old unscoped detail or playground paths', () => {
  assert.equal(entry('GET', '/v1/mcp/servers/{serverId}'), undefined);
  assert.equal(entry('POST', '/v1/mcp/servers/{serverId}/playground/tool-calls'), undefined);
});
