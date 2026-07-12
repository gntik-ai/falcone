// Unit tests for MCP per-tenant quotas + rate limits (change add-mcp-tenancy-isolation-quotas, #399).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MCP_QUOTA_DEFAULTS, evaluateServerCountQuota, evaluateToolCountQuota, evaluateToolCallRate,
  rateLimitKey, quotaEnforcementAudit,
} from './mcp-quota.mjs';

const plan = MCP_QUOTA_DEFAULTS.standard;

test('evaluateServerCountQuota: allows under the limit, denies at the limit', () => {
  assert.equal(evaluateServerCountQuota({ plan, currentServers: 9 }).allowed, true);
  const denied = evaluateServerCountQuota({ plan, currentServers: 10 });
  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'QUOTA_EXCEEDED');
  assert.equal(denied.httpStatus, 429);
  assert.equal(denied.dimension, 'servers_per_tenant');
});

test('evaluateToolCountQuota: denies when a server exposes more than the per-server limit', () => {
  assert.equal(evaluateToolCountQuota({ plan, toolCount: 50 }).allowed, true);
  assert.equal(evaluateToolCountQuota({ plan, toolCount: 51 }).allowed, false);
});

test('evaluateToolCallRate: per-server and per-oauth-client windows', () => {
  assert.equal(evaluateToolCallRate({ plan, scope: 'server', windowCount: 600 }).allowed, true);
  const serverBlocked = evaluateToolCallRate({ plan, scope: 'server', windowCount: 601 });
  assert.equal(serverBlocked.allowed, false);
  assert.equal(serverBlocked.code, 'RATE_LIMITED');
  assert.equal(serverBlocked.retryAfterSeconds, 60);
  assert.equal(serverBlocked.dimension, 'tool_calls_per_server');

  const clientBlocked = evaluateToolCallRate({ plan, scope: 'oauth_client', windowCount: 301 });
  assert.equal(clientBlocked.allowed, false);
  assert.equal(clientBlocked.dimension, 'tool_calls_per_oauth_client');
});

test('enforcement mode unbounded never blocks; unknown mode throws', () => {
  const unbounded = { ...plan, mode: 'unbounded' };
  assert.equal(evaluateServerCountQuota({ plan: unbounded, currentServers: 9999 }).allowed, true);
  assert.equal(evaluateToolCallRate({ plan: unbounded, scope: 'server', windowCount: 999999 }).allowed, true);
  assert.throws(() => evaluateServerCountQuota({ plan: { ...plan, mode: 'bogus' }, currentServers: 0 }), /enforcement mode/);
});

test('rateLimitKey is tenant + server (+ client) scoped — never collides across tenants', () => {
  const a = rateLimitKey({ tenantId: 'ten-a', serverId: 'srv1', scope: 'server' });
  const b = rateLimitKey({ tenantId: 'ten-b', serverId: 'srv1', scope: 'server' });
  assert.notEqual(a, b); // same server id, different tenant -> different budget
  assert.match(a, /^mcp:rl:ten-a:srv1:server$/);
  const client = rateLimitKey({ tenantId: 'ten-a', serverId: 'srv1', oauthClientId: 'oac9', scope: 'oauth_client' });
  assert.match(client, /^mcp:rl:ten-a:srv1:oac:oac9$/);
  assert.throws(() => rateLimitKey({ serverId: 'srv1', scope: 'server' }), /tenant id/);
});

test('quotaEnforcementAudit: a denied decision becomes a tenant-scoped mcp audit event', () => {
  const decision = evaluateToolCallRate({ plan, scope: 'oauth_client', windowCount: 301 });
  const ev = quotaEnforcementAudit(decision, { tenantId: 'ten-a', workspaceId: 'ws-1', serverId: 'srv1', oauthClientId: 'oac9', correlationId: 'c', eventId: 'e', eventTimestamp: 't' });
  assert.equal(ev.resource.subsystem, 'mcp');
  assert.equal(ev.action.category, 'quota_adjustment'); // a category in the audit-event-schema
  assert.equal(ev.action.id, 'mcp.quota.rate_limited');
  assert.equal(ev.result.outcome, 'denied');
  assert.equal(ev.scope.tenant_id, 'ten-a');
  assert.equal(ev.actor.actor_id, 'oac9');
  assert.equal(ev.detail.limit, 300);
  assert.throws(() => quotaEnforcementAudit(decision, { correlationId: 'c', eventId: 'e', eventTimestamp: 't' }), /tenant scope/);
});
