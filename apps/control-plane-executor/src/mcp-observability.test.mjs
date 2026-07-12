// Unit tests for MCP observability + audit shaping (change add-mcp-observability-audit, #398).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mcpToolCallTelemetry, mcpAuditEvent, buildTenantScopedMcpAuditQuery, filterAuditRecordsForTenant,
} from './mcp-observability.mjs';

const call = { tenantId: 'ten-a', workspaceId: 'ws-1', serverId: 'srv_acme', toolName: 'list_orders', oauthClientId: 'oac_123', latencyMs: 42, status: 'ok' };

test('mcpToolCallTelemetry: tool-call metric attributed to tenant/workspace/server/tool/oauth-client', () => {
  const { metric } = mcpToolCallTelemetry(call);
  assert.equal(metric.name, 'in_falcone_mcp_tool_invocations_total');
  assert.equal(metric.labels.subsystem, 'mcp');
  assert.equal(metric.labels.domain, 'mcp_tool_usage');
  assert.equal(metric.labels.metric_scope, 'workspace');
  assert.equal(metric.labels.tenant_id, 'ten-a');
  assert.equal(metric.labels.workspace_id, 'ws-1');
  assert.equal(metric.labels.server, 'srv_acme');
  assert.equal(metric.labels.tool_name, 'list_orders');
  assert.equal(metric.labels.oauth_client, 'oac_123');
  assert.equal(metric.labels.status_class, 'success');
});

test('mcpToolCallTelemetry: latency rides the normalized component-latency family (subsystem=mcp)', () => {
  const { latency } = mcpToolCallTelemetry(call);
  assert.equal(latency.name, 'in_falcone_component_operation_duration_seconds');
  assert.equal(latency.labels.subsystem, 'mcp');
  assert.equal(latency.observedSeconds, 0.042);
});

test('mcpToolCallTelemetry: emits a structured log line with the call attribution', () => {
  const { log } = mcpToolCallTelemetry(call);
  assert.equal(log.message, 'mcp.tool_call');
  assert.deepEqual(
    { tenant: log.tenant_id, server: log.server, tool: log.tool, oauth: log.oauth_client, ms: log.latency_ms, status: log.status },
    { tenant: 'ten-a', server: 'srv_acme', tool: 'list_orders', oauth: 'oac_123', ms: 42, status: 'success' }
  );
});

test('mcpToolCallTelemetry: never carries a forbidden (PII/high-cardinality) label', () => {
  // a caller cannot smuggle a forbidden label; the helper only emits bounded ones
  const { metric, latency } = mcpToolCallTelemetry(call);
  for (const labels of [metric.labels, latency.labels]) {
    for (const forbidden of ['user_id', 'request_id', 'raw_path', 'object_key', 'email', 'api_key_id']) {
      assert.equal(forbidden in labels, false);
    }
  }
});

test('mcpToolCallTelemetry: status maps to status_class (denied/error)', () => {
  assert.equal(mcpToolCallTelemetry({ ...call, status: 'denied' }).metric.labels.status_class, 'denied');
  assert.equal(mcpToolCallTelemetry({ ...call, status: 'error' }).metric.labels.status_class, 'error');
  // platform scope when no tenant
  assert.equal(mcpToolCallTelemetry({ ...call, tenantId: undefined, workspaceId: undefined }).metric.labels.metric_scope, 'platform');
});

test('mcpAuditEvent: per-OAuth-client event for the mcp subsystem, tenant-scoped', () => {
  const ev = mcpAuditEvent({ tenantId: 'ten-a', workspaceId: 'ws-1', oauthClientId: 'oac_123', action: 'consent_granted', serverId: 'srv_acme', correlationId: 'corr_1', eventId: 'evt_1', eventTimestamp: '2026-06-13T00:00:00Z' });
  assert.equal(ev.resource.subsystem, 'mcp');
  assert.equal(ev.actor.actor_type, 'oauth_client');
  assert.equal(ev.actor.actor_id, 'oac_123');
  assert.equal(ev.scope.mode, 'tenant_workspace');
  assert.equal(ev.scope.tenant_id, 'ten-a');
  assert.equal(ev.action.category, 'access_control_modification'); // a category in the audit-event-schema
  assert.equal(ev.action.id, 'mcp.consent_granted');
  assert.equal(ev.result.outcome, 'succeeded');
  assert.equal(ev.origin.origin_surface, 'control_api');
});

test('mcpAuditEvent: maps lifecycle actions to schema categories; rejects unknown/anon', () => {
  assert.equal(mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'client_registered', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }).action.category, 'resource_creation');
  assert.equal(mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'client_revoked', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }).action.category, 'resource_deletion');
  assert.equal(mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'scopes_changed', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }).action.category, 'configuration_change');
  assert.throws(() => mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'nope', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }), /Unknown MCP audit action/);
  assert.throws(() => mcpAuditEvent({ oauthClientId: 'c', action: 'client_registered', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }), /tenant scope/);
});

test('buildTenantScopedMcpAuditQuery: always pins the verified tenant + mcp subsystem', () => {
  const q = buildTenantScopedMcpAuditQuery({ tenantId: 'ten-a', oauthClientId: 'oac_123' });
  assert.equal(q.tenant_id, 'ten-a');
  assert.equal(q['filter[subsystem]'], 'mcp');
  assert.equal(q['filter[actor_id]'], 'oac_123');
  assert.throws(() => buildTenantScopedMcpAuditQuery({}), /verified tenant/);
});

test('filterAuditRecordsForTenant: cross-tenant records are never returned (isolation)', () => {
  const records = [
    { scope: { tenant_id: 'ten-a' }, action: { id: 'mcp.consent_granted' } },
    { scope: { tenant_id: 'ten-b' }, action: { id: 'mcp.client_revoked' } }, // other tenant
    { tenant_id: 'ten-a', action: { id: 'mcp.scopes_changed' } },
  ];
  const visibleToA = filterAuditRecordsForTenant(records, 'ten-a');
  assert.equal(visibleToA.length, 2);
  assert.equal(visibleToA.some((r) => (r.scope?.tenant_id ?? r.tenant_id) === 'ten-b'), false);
  assert.deepEqual(filterAuditRecordsForTenant(records, undefined), []);
});
