/**
 * One-time back-fill: create a real SeaweedFS S3 identity for every active
 * workspace storage boundary that predates change add-seaweedfs-tenant-identities
 * (provisioned while `provisionWorkspaceStorageBoundary` was a NOT_YET_IMPLEMENTED
 * stub, so no backend identity exists).
 *
 * For each workspace it calls `provisionWorkspaceStorageBoundary`, which writes a
 * per-tenant identity scoped to that workspace's own bucket (fail-closed if the
 * `workspace_buckets` mapping is missing). The pure orchestration lives in
 * {@link runBackfill} (fully injectable for tests); the main-guard at the bottom
 * wires env + pg + the real SeaweedFS IAM transport.
 *
 * --dry-run        plan only; no identity is written (default is also dry-run).
 * --apply          actually write identities.
 * --force-rotate   ALSO deliver/persist a fresh usable secret for each workspace.
 *
 * OQ1 — force-rotate existing credentials? (operator decision, deferred)
 *   DEFAULT (no --force-rotate): the back-fill writes a scoped identity but does
 *     NOT re-deliver a secret. The workspace keeps NO usable S3 key until its
 *     owner performs a manual rotation (which issues + delivers a new key under
 *     the grace-overlap window). Lowest blast radius; no secret is surfaced by a
 *     batch job. Each back-filled workspace is logged as needing a manual rotate.
 *   --force-rotate: the back-fill delivers the freshly generated secret via the
 *     injected `deliverSecret` sink so every workspace immediately has a usable
 *     key. Convenient but surfaces secrets from a batch process — only use with a
 *     secure one-time delivery channel.
 *   This script defaults to NO force-rotate pending the operator's decision.
 *
 * @module scripts/backfill-seaweedfs-identities
 */

import { provisionWorkspaceStorageBoundary } from '../services/adapters/src/storage-tenant-context.mjs';

export function parseBackfillArgs(argv = []) {
  const flags = { dryRun: true, forceRotate: false };
  for (const arg of argv) {
    if (arg === '--apply') flags.dryRun = false;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--force-rotate') flags.forceRotate = true;
  }
  return flags;
}

/**
 * Back-fill SeaweedFS identities for workspaces that lack one.
 *
 * @param {Object} opts
 * @param {string[]} [opts.argv]
 * @param {() => Promise<Array<{tenantId:string, workspaceId:string, bucketName?:string}>>} opts.loadWorkspacesNeedingIdentity
 * @param {Function} [opts.provisionFn] defaults to provisionWorkspaceStorageBoundary
 * @param {object} [opts.iamOptions] transport/options forwarded to the IAM client
 * @param {(workspaceId:string)=>Promise<string|null>} [opts.resolveBucketName]
 * @param {(record:object)=>Promise<void>} [opts.persistCredential]
 * @param {(secret:{workspaceId:string, accessKeyId:string, secretAccessKey:string})=>Promise<void>} [opts.deliverSecret]
 * @param {{write:Function}} [opts.outStream]
 * @returns {Promise<{exitCode:number, result:object}>}
 */
export async function runBackfill(opts = {}) {
  const {
    argv = [],
    loadWorkspacesNeedingIdentity,
    provisionFn = provisionWorkspaceStorageBoundary,
    iamOptions = {},
    resolveBucketName,
    persistCredential,
    deliverSecret,
    outStream = process.stdout,
  } = opts;

  const flags = parseBackfillArgs(argv);
  const emit = (obj) => outStream.write(`${JSON.stringify(obj)}\n`);

  if (typeof loadWorkspacesNeedingIdentity !== 'function') {
    const err = new Error('loadWorkspacesNeedingIdentity is required');
    emit({ ok: false, stage: 'load', error: err.message });
    return { exitCode: 1, result: { ok: false } };
  }

  const workspaces = await loadWorkspacesNeedingIdentity();
  const provisioned = [];
  const needsManualRotate = [];
  const failed = [];

  for (const ws of workspaces) {
    if (flags.dryRun) {
      provisioned.push({ workspaceId: ws.workspaceId, planned: true });
      continue;
    }
    try {
      const boundary = await provisionFn({
        tenantId: ws.tenantId,
        workspaceId: ws.workspaceId,
        bucketName: ws.bucketName,
        resolveBucketName,
        persistCredential,
        iamOptions,
      });

      if (boundary.reused) {
        provisioned.push({ workspaceId: ws.workspaceId, reused: true });
        continue;
      }

      provisioned.push({
        workspaceId: ws.workspaceId,
        identityName: boundary.identityName,
        accessKeyIdMasked: boundary.credential?.accessKeyIdMasked ?? null,
      });

      if (flags.forceRotate && boundary.secretEnvelope) {
        if (typeof deliverSecret === 'function') {
          await deliverSecret({
            workspaceId: ws.workspaceId,
            accessKeyId: boundary.secretEnvelope.accessKeyId,
            secretAccessKey: boundary.secretEnvelope.secretAccessKey,
          });
        }
      } else {
        // No force-rotate: secret is intentionally discarded; owner must rotate.
        needsManualRotate.push(ws.workspaceId);
      }
    } catch (error) {
      failed.push({ workspaceId: ws.workspaceId, code: error.code ?? 'INTERNAL_ERROR', message: error.message });
    }
  }

  const result = {
    ok: failed.length === 0,
    mode: flags.dryRun ? 'dry-run' : 'apply',
    forceRotate: flags.forceRotate,
    counts: {
      candidates: workspaces.length,
      provisioned: provisioned.length,
      needsManualRotate: needsManualRotate.length,
      failed: failed.length,
    },
    provisioned,
    needsManualRotate,
    failed,
  };
  emit(result);
  return { exitCode: failed.length === 0 ? 0 : 1, result };
}

/* c8 ignore start — thin main-guard: env/pg/IAM wiring, exercised only on real invocation. */
async function main() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PROVISIONING_DB_URL ?? process.env.DATABASE_URL });

  // Candidate source of truth: every workspace bucket maps to a workspace that
  // should own a SeaweedFS identity (the canonical workspace_buckets table).
  const loadWorkspacesNeedingIdentity = async () => {
    const { rows } = await pool.query(
      'SELECT DISTINCT workspace_id, tenant_id, bucket_name FROM workspace_buckets',
    );
    return rows.map((r) => ({ tenantId: r.tenant_id, workspaceId: r.workspace_id, bucketName: r.bucket_name }));
  };

  const { exitCode } = await runBackfill({
    argv: process.argv.slice(2),
    loadWorkspacesNeedingIdentity,
    // The IAM client reads SEAWEEDFS_S3_ADMIN_ENDPOINT / *_ACCESS_KEY / *_SECRET_KEY from env.
    iamOptions: {},
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
