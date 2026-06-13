// Unit tests for the MCP OAuth helpers (change add-mcp-oauth-authorization-server, #390).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolScopeName, deriveToolScopes, isHttpsRedirectUri, buildMcpClientRegistration, buildMcpOAuthProvisioningPlan } from './mcp-oauth.mjs';

test('buildMcpOAuthProvisioningPlan: N scope-creates then 1 client-create, tenant-scoped', () => {
  const plan = buildMcpOAuthProvisioningPlan({
    tenantId: 'ten_A', serverId: 'srv', clientId: 'c1',
    redirectUris: ['https://app/cb'], tools: [{ name: 'echo' }, { name: 'query' }],
  });
  assert.equal(plan.tenantId, 'ten_A');
  assert.deepEqual(plan.violations, []);
  assert.equal(plan.iamRequests.length, 3); // 2 scopes + 1 client
  assert.deepEqual(plan.iamRequests.map((r) => `${r.resourceKind}:${r.action}`), ['scope:create', 'scope:create', 'client:create']);
  assert.equal(plan.iamRequests[0].payload.name, 'mcp:srv:echo');
  assert.deepEqual(plan.iamRequests[2].payload.defaultClientScopes, ['mcp:srv:echo', 'mcp:srv:query']);
});

test('buildMcpOAuthProvisioningPlan: violations short-circuit (no IAM requests)', () => {
  const plan = buildMcpOAuthProvisioningPlan({
    tenantId: 'ten_A', serverId: 'srv', clientId: 'c1',
    redirectUris: ['http://insecure/cb'], tools: [{ name: 'echo' }],
  });
  assert.equal(plan.iamRequests.length, 0);
  assert.ok(plan.violations.some((v) => v.code === 'invalid_redirect_uri'));
});

test('toolScopeName: mcp:<server>:<tool>, sanitized', () => {
  assert.equal(toolScopeName('srv-1', 'echo'), 'mcp:srv-1:echo');
  assert.equal(toolScopeName('Srv A', 'tenant Info!'), 'mcp:srv-a:tenant-info');
});

test('deriveToolScopes: include.in.token.scope + consent text, deduped', () => {
  const scopes = deriveToolScopes('srv', [
    { name: 'echo', description: 'Echo back.' },
    { name: 'echo' }, // dup -> ignored
    { name: 'tenant_info' },
  ]);
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0].name, 'mcp:srv:echo');
  assert.equal(scopes[0].attributes['include.in.token.scope'], 'true');
  assert.equal(scopes[0].attributes['consent.screen.text'], 'Echo back.');
  assert.equal(scopes[1].attributes['consent.screen.text'], 'Call the tenant_info tool'); // default text
});

test('isHttpsRedirectUri: only https', () => {
  assert.equal(isHttpsRedirectUri('https://app.example.com/cb'), true);
  assert.equal(isHttpsRedirectUri('http://app.example.com/cb'), false);
  assert.equal(isHttpsRedirectUri('not a uri'), false);
});

test('buildMcpClientRegistration: valid HTTPS -> request with per-tool default scopes', () => {
  const { request, violations } = buildMcpClientRegistration({
    clientId: 'mcp-client-1', redirectUris: ['https://app.example.com/cb'],
    serverId: 'srv', tools: [{ name: 'echo' }, { name: 'query' }],
  });
  assert.deepEqual(violations, []);
  assert.equal(request.publicClient, false);
  assert.deepEqual(request.defaultClientScopes, ['mcp:srv:echo', 'mcp:srv:query']);
});

test('buildMcpClientRegistration: non-HTTPS redirect -> violation, no request', () => {
  const { request, violations } = buildMcpClientRegistration({
    clientId: 'c', redirectUris: ['http://insecure/cb'], serverId: 'srv', tools: [{ name: 'echo' }],
  });
  assert.equal(request, null);
  assert.ok(violations.some((v) => v.code === 'invalid_redirect_uri'));
});

test('buildMcpClientRegistration: plan limits enforced', () => {
  const { violations } = buildMcpClientRegistration({
    clientId: 'c', redirectUris: ['https://a/cb', 'https://b/cb'], serverId: 'srv',
    tools: [{ name: 't1' }, { name: 't2' }, { name: 't3' }],
    planLimits: { maxRedirectUris: 1, maxToolScopes: 2 },
  });
  assert.ok(violations.some((v) => v.code === 'redirect_uri_limit_exceeded'));
  assert.ok(violations.some((v) => v.code === 'tool_scope_limit_exceeded'));
});

test('buildMcpClientRegistration: missing clientId / redirect -> violations', () => {
  const { violations } = buildMcpClientRegistration({ serverId: 'srv', tools: [] });
  assert.ok(violations.some((v) => v.code === 'missing_client_id'));
  assert.ok(violations.some((v) => v.code === 'missing_redirect_uri'));
});
