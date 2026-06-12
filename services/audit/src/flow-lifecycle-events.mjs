// Flow lifecycle audit events (change: add-flows-tenancy-isolation-limits).
//
// Every flow lifecycle action emits a tenant-scoped audit event to the existing audit pipeline.
// The field conventions (tenantId / workspaceId / actorId / occurredAt) follow
// contract-boundary.mjs::capabilityEnforcementDeniedEvent so the audit consumers (retention
// classification, anomaly detector, query API) treat flow events identically to every other
// security/operational event.
//
// This module is Temporal-FREE and dependency-FREE so the control-plane flow executor can build
// the event envelope and hand it to an injected sink (Kafka producer in production, an in-memory
// array in black-box tests) without pulling the audit Kafka machinery into the control plane.

// The eight flow lifecycle action types (spec: All flow lifecycle actions emit audit events).
export const FLOW_AUDIT_EVENT_TYPES = Object.freeze({
  DEFINITION_CREATED: 'flow.definition_created',
  DEFINITION_UPDATED: 'flow.definition_updated',
  VERSION_PUBLISHED: 'flow.version_published',
  DEFINITION_DELETED: 'flow.definition_deleted',
  EXECUTION_STARTED: 'flow.execution_started',
  EXECUTION_CANCELLED: 'flow.execution_cancelled',
  EXECUTION_RETRY: 'flow.execution_retry',
  SIGNAL_SENT: 'flow.signal_sent',
});

const ALL_EVENT_TYPES = new Set(Object.values(FLOW_AUDIT_EVENT_TYPES));

/**
 * Build a `flow_lifecycle_event` audit envelope. `tenantId`, `workspaceId`, `actorId`, `flowId`
 * and `occurredAt` are MANDATORY (the spec: non-nullable). `flowVersion` is included where
 * applicable (publish / execution start / retry); execution / signal events carry `executionId`.
 *
 * Throws when a required field is missing or the eventType is not one of the eight — fail-closed
 * so a malformed audit emission is a load-time bug, never a silently dropped security event.
 *
 * @returns {object} the contract-shaped event
 */
export function buildFlowAuditEvent({
  eventType,
  tenantId,
  workspaceId,
  actorId,
  flowId,
  flowVersion = null,
  executionId = null,
  occurredAt = new Date().toISOString(),
  correlationId = null,
} = {}) {
  if (!ALL_EVENT_TYPES.has(eventType)) {
    throw new Error(`flow audit: unknown eventType "${eventType}"`);
  }
  for (const [k, v] of Object.entries({ tenantId, workspaceId, actorId, flowId, occurredAt })) {
    if (v === undefined || v === null || v === '') {
      throw new Error(`flow audit: missing required field "${k}" for ${eventType}`);
    }
  }
  return {
    eventType,
    category: 'flows',
    tenantId,
    workspaceId,
    actorId,
    flowId,
    flowVersion: flowVersion != null ? String(flowVersion) : null,
    executionId,
    correlationId,
    occurredAt,
  };
}
