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
 * Build the activity dependency object for the workflow-worker.
 *
 * When `opts.registry` is provided (test / pre-constructed path) no real DB connection
 * is opened — only the executor function is loaded. When omitted, a real pg Pool and
 * connection registry are created from the process environment.
 *
 * Returns `{ deps, close }`:
 *   deps   — { executePostgresData, pgRegistry }  to pass to activities.setActivityDeps()
 *   close  — async teardown: drains pools on SIGTERM
 *
 * @param {{ registry?: object }} [opts]
 * @returns {Promise<{ deps: object, close(): Promise<void> }>}
 */
export async function wireActivityDeps(opts = {}) {
  const { executePostgresData } = await dynamicImport(
    '../../../apps/control-plane/src/runtime/postgres-data-executor.mjs',
  );

  let registry = opts.registry;
  let keyPool;
  let executeLlmComplete;

  if (!registry) {
    const [
      { createConnectionRegistry },
      { createWorkspaceDsnResolver },
      { createLlmExecutor, createLlmProviderStore, createLlmUsageStore },
      { parseAllowedSecretPrefixes },
      pgModule,
      { withPostgresSsl },
    ] = await Promise.all([
      dynamicImport('../../../apps/control-plane/src/runtime/connection-registry.mjs'),
      dynamicImport('../../../apps/control-plane/src/runtime/workspace-dsn-resolver.mjs'),
      dynamicImport('../../../apps/control-plane/src/runtime/llm-executor.mjs'),
      dynamicImport('../../../apps/control-plane/src/runtime/byok-provider-guard.mjs'),
      dynamicImport('pg'),
      dynamicImport('../../../services/internal-contracts/src/transport-security.mjs'),
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
  }

  const deps = { executePostgresData, pgRegistry: registry, ...(executeLlmComplete ? { executeLlmComplete } : {}) };

  return {
    deps,
    async close() {
      await registry.end?.().catch(() => {});
      await keyPool?.end().catch(() => {});
    },
  };
}
