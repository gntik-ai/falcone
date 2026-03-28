import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH = 'services/internal-contracts/src/observability-audit-event-schema.json';
export const OBSERVABILITY_AUDIT_PIPELINE_PATH = 'services/internal-contracts/src/observability-audit-pipeline.json';
export const AUTHORIZATION_MODEL_PATH = 'services/internal-contracts/src/authorization-model.json';
export const ARCHITECTURE_AUDIT_EVENT_SCHEMA_DOC_PATH = 'docs/reference/architecture/observability-audit-event-schema.md';
export const ARCHITECTURE_README_PATH = 'docs/reference/architecture/README.md';
export const OBS_TASK_DOC_PATH = 'docs/tasks/us-obs-02.md';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_TOP_LEVEL_FIELDS = [
  'event_id',
  'event_timestamp',
  'actor',
  'scope',
  'resource',
  'action',
  'result',
  'correlation_id',
  'origin',
  'detail'
];
const REQUIRED_ACTOR_FIELDS = ['actor_id', 'actor_type'];
const REQUIRED_SCOPE_MODES = ['tenant', 'tenant_workspace', 'platform'];
const REQUIRED_TENANT_FIELDS = ['tenant_id'];
const REQUIRED_WORKSPACE_FIELDS = ['tenant_id', 'workspace_id'];
const REQUIRED_RESULT_OUTCOMES = ['succeeded', 'failed', 'denied', 'partial', 'accepted'];
const REQUIRED_ORIGIN_FIELDS = ['origin_surface', 'emitting_service'];
const REQUIRED_ORIGIN_SURFACES = [
  'control_api',
  'console_backend',
  'internal_reconciler',
  'provider_adapter',
  'bootstrap_job',
  'scheduled_operation'
];

export function readObservabilityAuditEventSchema() {
  return readJson(OBSERVABILITY_AUDIT_EVENT_SCHEMA_PATH);
}

export function readObservabilityAuditPipeline() {
  return readJson(OBSERVABILITY_AUDIT_PIPELINE_PATH);
}

export function readAuthorizationModel() {
  return readJson(AUTHORIZATION_MODEL_PATH);
}

export function collectAuditEventSchemaViolations(
  contract = readObservabilityAuditEventSchema(),
  auditPipeline = readObservabilityAuditPipeline(),
  authorizationModel = readAuthorizationModel()
) {
  const violations = [];

  if (typeof contract?.version !== 'string' || contract.version.length === 0) {
    violations.push('Observability audit event schema contract version must be a non-empty string.');
  }

  if (contract?.source_audit_pipeline_contract !== auditPipeline?.version) {
    violations.push('Observability audit event schema source_audit_pipeline_contract must align with observability-audit-pipeline.json version.');
  }

  if (contract?.source_authorization_contract !== authorizationModel?.version) {
    violations.push('Observability audit event schema source_authorization_contract must align with authorization-model.json version.');
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(contract?.required_top_level_fields ?? []).includes(field)) {
      violations.push(`Observability audit event schema must require top-level field ${field}.`);
    }
  }

  for (const field of REQUIRED_ACTOR_FIELDS) {
    if (!(contract?.actor?.required_fields ?? []).includes(field)) {
      violations.push(`Observability audit event schema actor section must require field ${field}.`);
    }
  }

  for (const mode of REQUIRED_SCOPE_MODES) {
    if (!(contract?.scope_envelope?.scope_modes ?? []).includes(mode)) {
      violations.push(`Observability audit event schema scope_envelope must include scope mode ${mode}.`);
    }
  }

  for (const field of REQUIRED_TENANT_FIELDS) {
    if (!((contract?.scope_envelope?.required_fields_by_mode?.tenant ?? []).includes(field))) {
      violations.push(`Observability audit event schema tenant scope must require field ${field}.`);
    }
  }

  for (const field of REQUIRED_WORKSPACE_FIELDS) {
    if (!((contract?.scope_envelope?.required_fields_by_mode?.tenant_workspace ?? []).includes(field))) {
      violations.push(`Observability audit event schema tenant_workspace scope must require field ${field}.`);
    }
  }

  if (!(contract?.required_top_level_fields ?? []).includes('correlation_id')) {
    violations.push('Observability audit event schema must require top-level field correlation_id.');
  }

  const pipelineCategories = new Set(
    (auditPipeline?.subsystem_roster ?? []).flatMap((subsystem) => subsystem?.required_event_categories ?? [])
  );
  const schemaCategories = new Set(contract?.action?.categories ?? []);

  for (const category of pipelineCategories) {
    if (!schemaCategories.has(category)) {
      violations.push(`Observability audit event schema action.categories must include pipeline category ${category}.`);
    }
  }

  for (const outcome of REQUIRED_RESULT_OUTCOMES) {
    if (!(contract?.result?.outcomes ?? []).includes(outcome)) {
      violations.push(`Observability audit event schema result.outcomes must include ${outcome}.`);
    }
  }

  for (const field of REQUIRED_ORIGIN_FIELDS) {
    if (!(contract?.origin?.required_fields ?? []).includes(field)) {
      violations.push(`Observability audit event schema origin section must require field ${field}.`);
    }
  }

  for (const surface of REQUIRED_ORIGIN_SURFACES) {
    if (!(contract?.origin?.origin_surfaces ?? []).includes(surface)) {
      violations.push(`Observability audit event schema origin.origin_surfaces must include ${surface}.`);
    }
  }

  const authorizationContext = authorizationModel?.contracts?.security_context?.required_fields ?? [];
  for (const field of ['actor', 'tenant_id', 'workspace_id', 'correlation_id']) {
    if (!authorizationContext.includes(field)) {
      violations.push(`Authorization model security_context_envelope must include ${field} for audit schema alignment.`);
    }
  }

  if (contract?.detail_extension?.field_name !== 'detail') {
    violations.push('Observability audit event schema detail_extension.field_name must be detail.');
  }

  if (contract?.detail_extension?.required !== true) {
    violations.push('Observability audit event schema detail_extension.required must be true.');
  }

  if (!(contract?.governance?.future_work_boundaries ?? []).includes('query_filters_are_defined_in_us_obs_02_t03')) {
    violations.push('Observability audit event schema governance must preserve the T03 query-filter boundary.');
  }

  return violations;
}
