import {
  AUDIT_MODULE_SERVICE_ID,
  getContract,
  getService,
  listAdapterPortsForConsumer
} from '../../internal-contracts/src/index.mjs';

export const auditModuleBoundary = getService(AUDIT_MODULE_SERVICE_ID);
export const auditRecordContract = getContract('audit_record');
export const iamLifecycleEventContract = getContract('iam_lifecycle_event');
export const mongoAdminEventContract = getContract('mongo_admin_event');
export const kafkaAdminEventContract = getContract('kafka_admin_event');
export const auditPersistenceAdapters = listAdapterPortsForConsumer(AUDIT_MODULE_SERVICE_ID);

/**
 * Capability enforcement denied event — security category (extended retention).
 *
 * Emitted when the gateway or console blocks an action because the tenant's plan
 * does not include the required boolean capability (or an override explicitly disables it).
 *
 * Classified alongside `scope_insufficient` and `privilege_domain_denied` for
 * retention policy purposes.
 */
export const capabilityEnforcementDeniedEvent = {
  eventType: 'capability_enforcement_denied',
  category: 'security',
  fields: {
    eventType: { type: 'string', enum: ['capability_enforcement_denied'] },
    tenantId: { type: 'string', description: 'UUID of the tenant' },
    workspaceId: { type: 'string', nullable: true, description: 'UUID of the workspace if applicable' },
    actorId: { type: 'string', description: 'sub from JWT or client_id' },
    actorType: { type: 'string', enum: ['user', 'service_account'] },
    capability: { type: 'string', description: 'Key of the blocked capability' },
    reason: { type: 'string', enum: ['plan_restriction', 'override_restriction', 'plan_unresolvable'] },
    channel: { type: 'string', enum: ['gateway', 'console', 'internal_api'] },
    resourcePath: { type: 'string', description: 'Requested resource path' },
    httpMethod: { type: 'string', description: 'HTTP method (GET, POST, etc.)' },
    requestId: { type: 'string', description: 'Request correlation ID' },
    correlationId: { type: 'string', description: 'End-to-end correlation ID' },
    sourceIp: { type: 'string', description: 'Client IP address' },
    occurredAt: { type: 'string', description: 'ISO 8601 UTC timestamp' }
  }
};

/**
 * Flow lifecycle event — flows category (change: add-flows-tenancy-isolation-limits).
 *
 * Emitted by the control-plane flow executor for each of the eight flow lifecycle actions:
 * definition created/updated/published(version)/deleted, execution started/cancelled/retry, and
 * signal sent. Carries the tenant context so the audit pipeline scopes, retains, and queries flow
 * activity exactly as it does every other tenant-scoped event. The authoritative envelope builder
 * is services/audit/src/flow-lifecycle-events.mjs::buildFlowAuditEvent.
 */
export const flowLifecycleEvent = {
  eventType: 'flow_lifecycle_event',
  category: 'flows',
  fields: {
    eventType: {
      type: 'string',
      enum: [
        'flow.definition_created',
        'flow.definition_updated',
        'flow.version_published',
        'flow.definition_deleted',
        'flow.execution_started',
        'flow.execution_cancelled',
        'flow.execution_retry',
        'flow.signal_sent'
      ]
    },
    tenantId: { type: 'string', description: 'UUID of the tenant' },
    workspaceId: { type: 'string', description: 'UUID of the workspace' },
    actorId: { type: 'string', description: 'sub from JWT or client_id (or apikey:<type>)' },
    flowId: { type: 'string', description: 'The flow definition id' },
    flowVersion: { type: 'string', nullable: true, description: 'Pinned/published version where applicable' },
    executionId: { type: 'string', nullable: true, description: 'Workflow execution id for execution/signal events' },
    correlationId: { type: 'string', nullable: true, description: 'End-to-end correlation ID' },
    occurredAt: { type: 'string', description: 'ISO 8601 UTC timestamp' }
  }
};
