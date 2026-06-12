// db.query activity (change: add-flows-activity-catalog / #360).
//
// Executes a Postgres or Mongo data-API operation through the EXISTING executor surface
// (D1: importable Node modules, no network hop) under the executing tenant's identity. The
// activity NEVER uses a static platform credential or the superuser role: it forwards the
// tenant-scoped short-lived `flc_service_…` credential (resolved upstream from the
// TenantContext envelope) into the executor `identity` with `dbRole = "falcone_service"`,
// so Postgres RLS / Mongo workspace scoping restricts the query to the tenant's own rows.
//
// Deps (injected by the catalog dispatch / tests):
//   - executePostgresData(registry, params)  from postgres-data-executor.mjs
//   - executeMongoData(params)               from mongo-data-executor.mjs
//   - pgRegistry                             the workspace-client registry for Postgres
import { assertPayloadSize, MAX_OUTPUT_BYTES } from './limits.mjs';
import { toNonRetryable, classifyExecutorError } from './errors.mjs';

const SERVICE_DB_ROLE = 'falcone_service';

// Executor `.code` → activity error code (D6). Schema/table-not-found and validation are
// deterministic (non-retryable). The generic classifier handles status-based mapping.
const PG_CODE_OVERRIDES = {
  UNDEFINED_TABLE: 'SCHEMA_ERROR',
  UNDEFINED_COLUMN: 'SCHEMA_ERROR',
  PLAN_REJECTED: 'SCHEMA_ERROR',
  INVALID_SCHEMA: 'SCHEMA_ERROR',
};
const MONGO_CODE_OVERRIDES = {
  PLAN_REJECTED: 'SCHEMA_ERROR',
};

/**
 * @param {{ params: object, tenant: { tenantId: string, workspaceId?: string }, credential?: object }} input
 * @param {{ executePostgresData?: Function, executeMongoData?: Function, pgRegistry?: object }} deps
 */
export async function dbQuery(input, deps = {}) {
  assertPayloadSize(input, 'input');

  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  if (!tenant.tenantId) {
    throw toNonRetryable('UNAUTHENTICATED', 'db.query requires a tenant context');
  }
  const workspaceId = params.workspaceId ?? tenant.workspaceId;
  if (!workspaceId) {
    throw toNonRetryable('UNAUTHENTICATED', 'db.query requires a workspaceId');
  }

  // The credential the execution run was issued (flc_service_… / falcone_service). Activities
  // CONSUME it; minting/expiry is owned by add-flows-tenancy-isolation-limits (#362).
  const credential = input.credential ?? {};
  const identity = {
    tenantId: tenant.tenantId,
    workspaceId,
    dbRole: credential.dbRole ?? SERVICE_DB_ROLE,
    roleName: credential.roleName ?? credential.dbRole ?? SERVICE_DB_ROLE,
    actorId: credential.actorId,
  };

  const engine = params.engine ?? 'postgres';
  let result;
  try {
    if (engine === 'mongo') {
      if (typeof deps.executeMongoData !== 'function') {
        throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'mongo executor not wired into db.query activity');
      }
      result = await deps.executeMongoData({
        operation: params.operation,
        workspaceId,
        databaseName: params.databaseName,
        collectionName: params.collectionName,
        documentId: params.documentId,
        filter: params.filter,
        projection: params.projection,
        sort: params.sort,
        page: params.page,
        payload: params.payload ?? params.values,
        identity,
      });
    } else if (engine === 'postgres') {
      if (typeof deps.executePostgresData !== 'function') {
        throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'postgres executor not wired into db.query activity');
      }
      result = await deps.executePostgresData(deps.pgRegistry, {
        operation: params.operation,
        workspaceId,
        databaseName: params.databaseName,
        schemaName: params.schemaName,
        tableName: params.tableName,
        rowId: params.rowId,
        filter: params.filter,
        values: params.values ?? params.payload,
        page: params.page,
        identity,
      });
    } else {
      throw toNonRetryable('SCHEMA_ERROR', `db.query unsupported engine "${engine}"`);
    }
  } catch (err) {
    // Already-classified activity failures (ApplicationFailure) pass through untouched.
    if (err?.name === 'ApplicationFailure') throw err;
    const overrides = engine === 'mongo' ? MONGO_CODE_OVERRIDES : PG_CODE_OVERRIDES;
    throw classifyExecutorError(err, overrides);
  }

  const output = { status: 'success', result };
  assertPayloadSize(output, 'output', MAX_OUTPUT_BYTES);
  return output;
}

export const dbQueryInputSchema = Object.freeze({
  $id: 'flows/activity/db.query/input',
  type: 'object',
  required: ['engine', 'operation'],
  properties: {
    engine: { type: 'string', enum: ['postgres', 'mongo'] },
    operation: { type: 'string' },
    databaseName: { type: 'string' },
    schemaName: { type: 'string' },
    tableName: { type: 'string' },
    collectionName: { type: 'string' },
    documentId: { type: 'string' },
    rowId: { type: 'string' },
    filter: { type: 'object' },
    values: { type: 'object' },
    payload: { type: 'object' },
  },
  additionalProperties: true,
});

export const dbQueryOutputSchema = Object.freeze({
  $id: 'flows/activity/db.query/output',
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', const: 'success' },
    result: {},
  },
  additionalProperties: false,
});
