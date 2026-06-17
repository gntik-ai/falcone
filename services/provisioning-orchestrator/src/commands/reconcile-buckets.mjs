/**
 * SeaweedFS bucket reconciliation command (add-seaweedfs-bucket-lifecycle-migration).
 *
 * Order of operations:
 *   1. checkPrerequisites — reachable endpoint + configured credentials (else exit non-zero).
 *   2. load workspace_buckets rows (canonical source of truth).
 *   3. discover source MinIO buckets, backfill missing rows (when a source client is given).
 *   4. reconcileAllBuckets — idempotent HEAD-then-create + compat-gated config apply.
 *   5. enforceIsolationPolicies — per-bucket owning-workspace policy.
 *   6. emit a structured JSON plan/result on stdout; gap log as NDJSON on the gap stream.
 *
 * `--dry-run` records every planned action without issuing any backend write.
 *
 * The pure orchestration lives in {@link runReconcileBuckets} (fully injectable
 * for tests); the main-guard at the bottom wires env + pg + a real S3 client.
 *
 * @module commands/reconcile-buckets
 */

import {
  checkPrerequisites,
  reconcileAllBuckets,
  enforceIsolationPolicies,
} from '../reconcilers/bucket-reconciler.mjs';
import {
  discoverS3Buckets,
  mergeDiscoveredBuckets,
  insertMissingWorkspaceBucketRows,
} from '../reconcilers/bucket-discovery.mjs';
import { GapLogger } from '../reconcilers/gap-logger.mjs';
import { DEFAULT_COMPAT_MATRIX } from '../reconcilers/compat-gate.mjs';
import { sanitizeBucketName } from '../utils/bucket-name-validator.mjs';

/** Parse the supported flags from an argv array. */
export function parseReconcileArgs(argv = []) {
  const flags = { dryRun: false, seaweedfsVersion: null };
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--apply') flags.dryRun = false;
    else if (arg.startsWith('--seaweedfs-version=')) flags.seaweedfsVersion = arg.slice('--seaweedfs-version='.length);
  }
  return flags;
}

function buildPlannedActions(reconciliation, isolation) {
  const actions = [];
  for (const o of reconciliation.outcomes) {
    if (o.action === 'would_create' || o.action === 'created') {
      actions.push({ type: 'create-bucket', bucketName: o.bucketName });
    }
  }
  for (const cr of reconciliation.configResults ?? []) {
    for (const pa of cr.plannedActions ?? []) actions.push(pa);
  }
  for (const a of isolation?.applied ?? []) {
    actions.push({ type: 'put-bucket-policy', bucketName: a.bucketName, identity: a.identity });
  }
  return actions;
}

/**
 * Run the reconciliation. All side-effecting collaborators are injected so this
 * is unit/integration testable without a real backend or DB.
 *
 * @param {Object} opts
 * @param {string[]} [opts.argv]
 * @param {object} opts.seaweedfsClient
 * @param {object} [opts.sourceClient] - source MinIO client for discovery
 * @param {{endpoint?:string, accessKeyId?:string, secretAccessKey?:string}} [opts.config]
 * @param {() => Promise<Array>} opts.loadWorkspaceBuckets
 * @param {(name:string)=>object|null} [opts.associate]
 * @param {{query:Function}} [opts.pool]
 * @param {string} [opts.seaweedfsVersion]
 * @param {{write:Function}} [opts.outStream]
 * @param {{write:Function}} [opts.gapStream]
 * @param {boolean} [opts.enforceIsolation=true]
 * @returns {Promise<{ exitCode: number, result?: object, error?: Error }>}
 */
export async function runReconcileBuckets(opts = {}) {
  const {
    argv = [],
    seaweedfsClient,
    sourceClient = null,
    config = {},
    loadWorkspaceBuckets,
    associate = null,
    pool = null,
    seaweedfsVersion: versionOpt,
    outStream = process.stdout,
    gapStream = process.stderr,
    enforceIsolation = true,
  } = opts;

  const flags = parseReconcileArgs(argv);
  const dryRun = flags.dryRun;
  const seaweedfsVersion = flags.seaweedfsVersion ?? versionOpt ?? config.version ?? DEFAULT_COMPAT_MATRIX.defaultVersion;
  const emit = (obj) => outStream.write(`${JSON.stringify(obj, null, 2)}\n`);

  // 1. Prerequisite check FIRST — no bucket/config write happens before this passes.
  try {
    await checkPrerequisites(seaweedfsClient, config);
  } catch (err) {
    emit({ ok: false, stage: 'prerequisites', error: err.message, code: err.code, field: err.field, endpoint: err.endpoint });
    return { exitCode: 1, error: err };
  }

  if (typeof loadWorkspaceBuckets !== 'function') {
    const err = new Error('loadWorkspaceBuckets is required');
    emit({ ok: false, stage: 'load', error: err.message });
    return { exitCode: 1, error: err };
  }

  let rows = await loadWorkspaceBuckets();

  // 2. Discovery + backfill (only when a source client is provided).
  let discovery = null;
  if (sourceClient) {
    const discovered = await discoverS3Buckets(sourceClient);
    const merged = mergeDiscoveredBuckets(discovered, rows);
    let backfill = { inserted: [], skipped: [] };
    if (associate) {
      backfill = await insertMissingWorkspaceBucketRows(merged.missing, { pool: dryRun ? null : pool, associate });
      rows = rows.concat(
        backfill.inserted.map((b) => ({
          workspace_id: b.workspaceId,
          tenant_id: b.tenantId,
          bucket_name: b.bucketName,
          region: b.region,
        })),
      );
    }
    discovery = {
      discovered,
      missing: merged.missing.map((m) => m.bucketName),
      inserted: backfill.inserted,
      skipped: backfill.skipped,
    };
  }

  // 3. Reconcile.
  const gapLogger = new GapLogger({ stream: gapStream });
  const reconciliation = await reconcileAllBuckets(rows, seaweedfsClient, { dryRun, seaweedfsVersion, gapLogger });

  // 4. Isolation enforcement on the non-conflicting rows.
  let isolation = null;
  if (enforceIsolation) {
    const conflictNames = new Set(reconciliation.conflicts.map((c) => c.bucketName));
    const reconciledRows = rows.filter((r) => !conflictNames.has(sanitizeBucketName(r.bucket_name)));
    isolation = await enforceIsolationPolicies(reconciledRows, seaweedfsClient, { dryRun });
  }

  const result = {
    ok: true,
    mode: dryRun ? 'dry-run' : 'apply',
    seaweedfsVersion,
    discovery,
    reconciliation: {
      created: reconciliation.created,
      existing: reconciliation.existing,
      conflicts: reconciliation.conflicts,
      outcomes: reconciliation.outcomes,
      configResults: reconciliation.configResults,
    },
    gapEntries: gapLogger.entries,
    isolation,
    plannedActions: buildPlannedActions(reconciliation, isolation),
  };
  emit(result);
  return { exitCode: 0, result };
}

/* c8 ignore start — thin main-guard: env/pg/S3 wiring, exercised only on real invocation. */
async function main() {
  const { createSeaweedFSClient } = await import('../reconcilers/s3-rest-client.mjs');
  const { default: pg } = await import('pg');

  const config = {
    endpoint: process.env.SEAWEEDFS_S3_ENDPOINT,
    accessKeyId: process.env.SEAWEEDFS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.SEAWEEDFS_S3_SECRET_ACCESS_KEY,
    region: process.env.SEAWEEDFS_S3_REGION ?? 'us-east-1',
    version: process.env.SEAWEEDFS_VERSION,
  };
  const seaweedfsClient = createSeaweedFSClient(config);

  const pool = new pg.Pool({ connectionString: process.env.PROVISIONING_DB_URL ?? process.env.DATABASE_URL });
  const loadWorkspaceBuckets = async () => {
    const { rows } = await pool.query('SELECT workspace_id, tenant_id, bucket_name, region FROM workspace_buckets');
    return rows;
  };

  const { exitCode } = await runReconcileBuckets({
    argv: process.argv.slice(2),
    seaweedfsClient,
    config,
    loadWorkspaceBuckets,
    pool,
  });
  await pool.end().catch(() => {});
  process.exit(exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
/* c8 ignore stop */
