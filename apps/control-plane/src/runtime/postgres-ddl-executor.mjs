// PostgreSQL DDL executor (change: add-postgres-ddl-execute).
//
// Executes the schema/DDL plans the adapters BUILD but never ran: structural DDL
// (table/column/index/constraint/view) via postgresql-structural-admin and
// governance DDL (policy/grant/extension/table_security/RLS) via
// postgresql-governance-admin. Both builders are self-contained, render fully-quoted,
// injection-guarded SQL statements, and tag the plan `transactional_ddl` — so the
// executor runs all statements as ONE transaction on the ADMIN (owner/migration)
// connection (the restricted app role cannot create objects). `executionMode: preview`
// returns the statements without running them (what the console did before).
import {
  buildPostgresStructuralSqlPlan,
  POSTGRES_STRUCTURAL_RESOURCE_KINDS,
} from '../../../../services/adapters/src/postgresql-structural-admin.mjs';
import {
  buildPostgresGovernanceSqlPlan,
  POSTGRES_GOVERNANCE_RESOURCE_KINDS,
} from '../../../../services/adapters/src/postgresql-governance-admin.mjs';
import { clientError, mapPgError } from './errors.mjs';

const IDENT = /^[a-z_][a-z0-9_]*$/;

function quoteIdent(name, what) {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw clientError(`Invalid ${what} identifier`, 400, 'INVALID_IDENTIFIER');
  }
  return `"${name}"`;
}

// Build the DDL statement plan for a resource kind. database/schema are rendered
// directly (the adapter keeps those builders internal); everything else uses the
// adapter's structural/governance SQL renderers.
function buildDdlPlan({ resourceKind, action, payload }) {
  if (resourceKind === 'schema') {
    if (action !== 'create') throw clientError(`Unsupported schema action ${action}`, 400, 'UNSUPPORTED_ACTION');
    const name = quoteIdent(payload.schemaName ?? payload.name, 'schemaName');
    return { statements: [`CREATE SCHEMA IF NOT EXISTS ${name}`], transactionMode: 'transactional_ddl' };
  }

  // Surface the pgvector `vector` type in the allowed type catalog when this DDL declares
  // a vector column or a vector index (add-vector-search). The structural builder gates
  // the `vector` type on enabledExtensions; if the extension is not actually installed the
  // CREATE will fail at execution and be mapped by mapPgError. Vector currentTable column
  // types let the index validator confirm the target column is a vector.
  const declaresVector =
    /vector/i.test(String(payload.dataType ?? payload.type ?? '')) ||
    ['hnsw', 'ivfflat'].includes(String(payload.indexMethod ?? payload.method ?? '').toLowerCase());
  const context = {
    databaseName: payload.databaseName,
    schemaName: payload.schemaName,
    tableName: payload.tableName,
    ...(declaresVector ? { clusterFeatures: { enabledExtensions: ['vector'] } } : {}),
  };

  try {
    if (POSTGRES_GOVERNANCE_RESOURCE_KINDS.includes(resourceKind)) {
      return buildPostgresGovernanceSqlPlan({ resourceKind, action, payload, context });
    }
    if (POSTGRES_STRUCTURAL_RESOURCE_KINDS.includes(resourceKind) && resourceKind !== 'type') {
      return buildPostgresStructuralSqlPlan({ resourceKind, action, payload, context });
    }
  } catch (error) {
    if (error.validation) {
      const violations = (error.validation.violations ?? []).join('; ');
      throw clientError(`DDL request rejected: ${violations}`, 400, 'DDL_INVALID');
    }
    throw clientError(error.message, 400, 'DDL_INVALID');
  }

  throw clientError(`Unsupported DDL resource kind ${resourceKind}`, 400, 'UNSUPPORTED_RESOURCE');
}

// Execute (or preview) a DDL request.
// params: { resourceKind, action, payload, identity:{workspaceId,...}, executionMode }
export async function executePostgresDdl(registry, params) {
  const { resourceKind, action = 'create', payload = {}, identity = {} } = params;
  const workspaceId = params.workspaceId ?? identity.workspaceId;
  if (!identity.tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING');
  if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING');

  const plan = buildDdlPlan({ resourceKind, action, payload });
  const statements = plan?.statements ?? [];
  const executionMode = params.executionMode ?? (payload.dryRun ? 'preview' : 'execute');

  if (executionMode === 'preview') {
    return { executed: false, executionMode: 'preview', statements };
  }
  if (statements.length === 0) {
    return { executed: false, executionMode: 'execute', statements: [], note: 'no_op' };
  }

  // DDL runs on the admin/owner connection (the app role cannot create objects),
  // as a single transactional unit (transactional_ddl).
  return registry.withAdminClient(workspaceId, async (client) => {
    try {
      await client.query('BEGIN');
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* surface original */ }
      throw mapPgError(error);
    }
    return { executed: true, executionMode: 'execute', statementCount: statements.length, statements };
  });
}
