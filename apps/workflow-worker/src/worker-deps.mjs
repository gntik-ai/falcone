// Worker activity deps factory (change: fix-flows-worker-db-activity-wiring / #563).
//
// Builds the platform executor surfaces (postgres executor + connection registry) from the
// worker's environment configuration and returns them as an activity deps object that
// worker.ts feeds into activities.setActivityDeps().
//
// Separated as a native-ESM (.mjs) module so:
//   (a) worker.ts (CJS) loads it via the `new Function` dynamic-import trick (same pattern
//       used by activities/index.ts to load catalog.mjs),
//   (b) black-box tests can import it directly without a tsc build step.
//
// ENVIRONMENT (read by buildDataDsn):
//   WORKER_DATA_DSN       Full postgres DSN — used verbatim (highest priority).
//   DATA_DB_URL / DB_URL  Alternative DSN env names (mirrors control-plane main.mjs).
//   PGHOST / PGUSER / PGPASSWORD / PGDATABASE / PGPORT
//                         Component env vars (Helm-injected in the kind/chart profile).

// --------------------------------------------------------------------------
// Dynamic ESM loader (same trick as activities/index.ts) so the CJS-compiled
// worker.ts dist can import these pure-ESM runtime modules without tsc rewriting
// `import()` into `require()`.
// --------------------------------------------------------------------------
const dynamicImport = new Function('spec', 'return import(spec)');

/**
 * Compose a Postgres DSN from environment variables.
 *
 * Priority:
 *   1. WORKER_DATA_DSN (explicit, verbatim)
 *   2. DATA_DB_URL / DB_URL  (control-plane naming compatibility)
 *   3. PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT (component env)
 *
 * @param {Record<string,string|undefined>} [env]  Defaults to process.env.
 * @returns {string}  A postgres:// connection string.
 */
export function buildDataDsn(env = process.env) {
  if (env.WORKER_DATA_DSN) return env.WORKER_DATA_DSN;
  if (env.DATA_DB_URL) return env.DATA_DB_URL;
  if (env.DB_URL) return env.DB_URL;

  const user = env.PGUSER ?? 'falcone_app';
  const pw = env.PGPASSWORD ?? '';
  const host = env.PGHOST ?? 'localhost';
  const port = env.PGPORT ?? '5432';
  const db = env.PGDATABASE ?? 'falcone';
  const auth = pw ? `${user}:${encodeURIComponent(pw)}` : user;
  return `postgres://${auth}@${host}:${port}/${db}`;
}

/**
 * Build the `loadFlowDefinition` activity dependency: the load-by-reference resolver used by
 * the `sub-flow` DSL node (`DslInterpreterWorkflow.runSubFlow` → child `executeChild` with a
 * reference input → child resolves the definition via this dependency). Reads the IMMUTABLE
 * published snapshot from `flow_versions` (../falcone-charts/charts/in-falcone/bootstrap/migrations/
 * 20260612-003-flow-definitions-and-versions.sql), scoped to the parent's tenant + workspace.
 *
 * SELF-CONTAINED on purpose: it uses ONLY the `pg` pool (no createFlowStore import — that
 * static-imports the DSL validators which are NOT in the worker image, so importing it would
 * crash the worker at boot with ERR_MODULE_NOT_FOUND, the #660 class; the Dockerfile drift
 * guard only checks worker-deps.mjs dynamic imports, not transitive static imports). Keeping
 * the reader inline means NO new dynamic import and NO Dockerfile COPY change.
 *
 * RLS (CRITICAL): `flow_versions` has FORCE ROW LEVEL SECURITY with a policy keyed on the
 * session GUCs `app.tenant_id` / `app.workspace_id` (20260612-004-flow-rls.sql). The worker
 * connects as `falcone_app` (non-BYPASSRLS), so a plain SELECT returns ZERO rows. The reader
 * therefore opens a transaction and sets both GUCs with `set_config(..., true)` (transaction-
 * scoped, mirroring connection-registry.mjs::applyRlsContext) BEFORE the SELECT. The explicit
 * `WHERE tenant_id=$1 AND workspace_id=$2 AND flow_id=$3 AND version=$4` predicates ALSO scope
 * the row (defense-in-depth preserved): a cross-tenant / foreign-workspace / missing reference
 * yields zero rows → null → the activity fails the parent (it never substitutes a placeholder).
 *
 * @param {{ pool: import('pg').Pool }} args
 * @returns {(input: { tenantId: string, workspaceId?: string, flowId: string, version: number })
 *           => Promise<unknown|null>} the published `definition_json`, or null when unresolvable.
 */
export function createFlowDefinitionLoader({ pool }) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('createFlowDefinitionLoader requires a pg Pool');
  }
  return async function loadFlowDefinition({ tenantId, workspaceId, flowId, version }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Establish the RLS context (transaction-scoped) so FORCE RLS returns this tenant's rows.
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', String(tenantId)]);
      await client.query('SELECT set_config($1, $2, true)', [
        'app.workspace_id',
        String(workspaceId ?? ''),
      ]);
      const result = await client.query(
        `SELECT definition_json
           FROM flow_versions
          WHERE tenant_id = $1 AND workspace_id = $2 AND flow_id = $3 AND version = $4`,
        [String(tenantId), String(workspaceId ?? ''), String(flowId), version],
      );
      await client.query('COMMIT');
      return result.rows[0]?.definition_json ?? null;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* surface the original error */
      }
      throw error;
    } finally {
      client.release();
    }
  };
}

/**
 * Build the activity dependency object for the workflow-worker.
 *
 * When `opts.registry` is provided (test / pre-constructed path) no real DB connection
 * is opened — only the executor function is loaded. When omitted, a real pg Pool and
 * connection registry are created from the process environment.
 *
 * Returns `{ deps, close }`:
 *   deps   — { executePostgresData, pgRegistry, loadFlowDefinition }  → activities.setActivityDeps()
 *   close  — async teardown: drains pools on SIGTERM
 *
 * @param {{ registry?: object }} [opts]
 * @returns {Promise<{ deps: object, close(): Promise<void> }>}
 */
export async function wireActivityDeps(opts = {}) {
  const { executePostgresData } = await dynamicImport(
    '../../../apps/control-plane-executor/src/runtime/postgres-data-executor.mjs',
  );

  let registry = opts.registry;
  let keyPool;
  let executeLlmComplete;
  let loadFlowDefinition;

  if (!registry) {
    const [
      { createConnectionRegistry },
      { createWorkspaceDsnResolver },
      { createLlmExecutor, createLlmProviderStore, createLlmUsageStore },
      { parseAllowedSecretPrefixes },
      pgModule,
      { withPostgresSsl },
    ] = await Promise.all([
      dynamicImport('../../../apps/control-plane-executor/src/runtime/connection-registry.mjs'),
      dynamicImport('../../../apps/control-plane-executor/src/runtime/workspace-dsn-resolver.mjs'),
      dynamicImport('../../../apps/control-plane-executor/src/runtime/llm-executor.mjs'),
      dynamicImport('../../../apps/control-plane-executor/src/runtime/byok-provider-guard.mjs'),
      dynamicImport('pg'),
      dynamicImport('../../../packages/internal-contracts/src/transport-security.mjs'),
    ]);

    const dsn = buildDataDsn(process.env);
    // A small shared pool for the workspace-db routing table (workspace_databases).
    // Uses the same credential/host as the data-plane DSN — no separate admin pool needed
    // for the worker (it only reads routing records, never writes schema).
    const pg = pgModule.default ?? pgModule;
    keyPool = new pg.Pool(withPostgresSsl({ connectionString: dsn, max: 2 }));
    const resolveConnection = createWorkspaceDsnResolver({ pool: keyPool, baseDsn: dsn });
    registry = createConnectionRegistry({ resolveConnection });

    // BYOK LLM completion executor for the llm.complete activity (change #640). Binds the provider
    // config + usage stores to the worker pool — mirrors the control-plane executor. The
    // control-plane owns DDL for these tables; the worker only reads config + appends usage.
    //
    // BYOK confinement (#659): pass the reserved secret-name allow-list so the executor DEFAULTS a
    // CONFINED secretResolver (the resolved key is read ONLY from an allow-listed env var, never an
    // arbitrary caller-named one) and inherits the endpoint SSRF guard. A flow `llm.complete`
    // against a malicious pre-existing provider row therefore fails closed.
    const llmExecutor = createLlmExecutor({
      providerStore: createLlmProviderStore({ pool: keyPool }),
      usageStore: createLlmUsageStore({ pool: keyPool }),
      secretPrefixes: parseAllowedSecretPrefixes(process.env),
    });
    executeLlmComplete = (req = {}) => llmExecutor.complete(req.workspaceId, req);

    // Load-by-reference resolver for the sub-flow node (#679). Bound to the same worker pool
    // (falcone_app on kind); the reader sets the RLS GUCs per transaction so the FORCE-RLS
    // flow_versions SELECT returns the parent tenant's published child definition. On kind the
    // worker's DSN already reaches the shared `in_falcone` control DB where flow_versions lives,
    // so no separate control-DB pool is needed.
    loadFlowDefinition = createFlowDefinitionLoader({ pool: keyPool });
  }

  const deps = {
    executePostgresData,
    pgRegistry: registry,
    ...(executeLlmComplete ? { executeLlmComplete } : {}),
    ...(loadFlowDefinition ? { loadFlowDefinition } : {}),
  };

  return {
    deps,
    async close() {
      await registry.end?.().catch(() => {});
      await keyPool?.end().catch(() => {});
    },
  };
}
