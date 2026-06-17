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

// The shared api-key DB roles the data API connects as (see connection-registry: SET LOCAL
// ROLE <dbRole> per request) and the GUC the RLS context is set in.
const DATA_API_ROLES = ['falcone_service', 'falcone_anon'];
const TENANT_COLUMN = 'tenant_id';

// B1 (#494): a table created through the DDL API must be (a) immediately usable by the data
// API and (b) isolated per tenant. The data API runs as a SHARED api-key role
// (falcone_service/falcone_anon) and scopes every row by `tenant_id` — the executor stamps it
// on writes and the adapter injects a `tenant_id = current_setting('app.tenant_id')` predicate
// (postgres-data-executor.mjs: gated on the table HAVING a tenant_id column). Before this fix
// CREATE TABLE emitted no GRANT (so the role couldn't even see the table → TABLE_NOT_FOUND) and
// no tenant_id column / RLS (so a table would leak across tenants). So at creation we:
//   1. ensure a `tenant_id` column exists (no-op if the caller already declared it),
//   2. GRANT the api-key roles schema USAGE + table DML, and
//   3. install FORCE row-level security keyed on tenant_id — mirroring the executor's policy,
//      so even a forgotten adapter predicate cannot cross tenants.
// These run on the RLS-bypassing admin/owner connection, inside the same create transaction.
function tableIsolationStatements(schemaName, tableName) {
  const schema = quoteIdent(schemaName, 'schemaName');
  const table = `${schema}.${quoteIdent(tableName, 'tableName')}`;
  const roles = DATA_API_ROLES.map((role) => quoteIdent(role, 'role')).join(', ');
  const tenantMatch = `${quoteIdent(TENANT_COLUMN, 'column')} = current_setting('app.tenant_id', true)`;
  const policy = quoteIdent(`${tableName}_tenant_isolation`, 'policyName');
  return [
    // Tenant discriminator the executor stamps and the RLS policy keys on. NOT NULL + a GUC
    // default means a row can never be written without a tenant; on a freshly created (empty)
    // table the ADD COLUMN is unconditional.
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${quoteIdent(TENANT_COLUMN, 'column')} text NOT NULL DEFAULT current_setting('app.tenant_id', true)`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${roles}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${roles}`,
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY ${policy} ON ${table} USING (${tenantMatch}) WITH CHECK (${tenantMatch})`,
  ];
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
      const structural = buildPostgresStructuralSqlPlan({ resourceKind, action, payload, context });
      // B1 (#494): make a newly created table immediately usable by the data API and
      // tenant-isolated by appending grants + tenant_id + FORCE RLS to the same DDL unit.
      if (resourceKind === 'table' && action === 'create') {
        const schemaName = payload.schemaName ?? context.schemaName;
        const tableName = payload.tableName ?? context.tableName;
        structural.statements = [
          ...(structural.statements ?? []),
          ...tableIsolationStatements(schemaName, tableName),
        ];
      }
      return structural;
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
