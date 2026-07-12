/**
 * One-time back-fill: provision a per-tenant DocumentDB credential for every active tenant
 * that predates change add-ferretdb-tenant-isolation-credentials (#458) and therefore has
 * no per-tenant FerretDB identity — they currently ride the shared MONGO_URI credential.
 *
 * For each tenant it calls `provisionTenantIdentity` (the DocumentDB identity applier),
 * which issues a wire-protocol `createUser` over FerretDB, yielding a non-superuser /
 * non-BYPASSRLS Postgres login role. The pure orchestration lives in {@link runBackfill}
 * (fully injectable for tests); the main-guard at the bottom wires env + pg + a real
 * MongoDB wire-protocol client to the FerretDB gateway.
 *
 * REMINDER: the per-tenant credential is least-privilege auth + audit, NOT a tenant
 * isolation boundary (ADR-14). App-layer tenantId scoping stays authoritative.
 *
 * --dry-run        plan only; no credential is created (default is also dry-run).
 * --apply          actually issue createUser per tenant.
 * --force-rotate   ALSO deliver the freshly generated password via the injected
 *                  `deliverSecret` sink (resolves Design OQ1; default: no-force-rotate).
 *
 * OQ1 — force-rotate existing tenant credentials? (operator decision, deferred)
 *   DEFAULT (no --force-rotate): the back-fill creates the credential and persists it to
 *     the secret store, but does NOT surface the plaintext from this batch job. Each
 *     back-filled tenant is logged as needing a manual rotation to obtain a usable key.
 *   --force-rotate: the back-fill delivers the freshly generated password via the
 *     injected `deliverSecret` sink. Convenient but surfaces secrets from a batch
 *     process — only use with a secure one-time delivery channel. May briefly drop
 *     active sessions authenticated with a prior password.
 *
 * @module scripts/backfill-ferretdb-tenant-identities
 */

import { provisionTenantIdentity } from '../packages/provisioning-orchestrator/src/appliers/documentdb-identity-applier.mjs';

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
 * Back-fill DocumentDB identities for tenants that lack one.
 *
 * @param {Object} opts
 * @param {string[]} [opts.argv]
 * @param {() => Promise<Array<{tenantId:string}>>} opts.loadTenantsNeedingIdentity
 * @param {Function} [opts.provisionFn] defaults to provisionTenantIdentity
 * @param {Object} [opts.credentials] wire-protocol client ({ runCommand } or { mongoClient })
 * @param {{ put: Function }} [opts.secretStore]
 * @param {(event:object)=>void} [opts.emitAudit]
 * @param {(secret:{tenantId:string, userName:string, password:string})=>Promise<void>} [opts.deliverSecret]
 * @param {{write:Function}} [opts.outStream]
 * @returns {Promise<{exitCode:number, result:object}>}
 */
export async function runBackfill(opts = {}) {
  const {
    argv = [],
    loadTenantsNeedingIdentity,
    provisionFn = provisionTenantIdentity,
    credentials = {},
    secretStore,
    emitAudit,
    deliverSecret,
    outStream = process.stdout,
  } = opts;

  const flags = parseBackfillArgs(argv);
  const emit = (obj) => outStream.write(`${JSON.stringify(obj)}\n`);

  if (typeof loadTenantsNeedingIdentity !== 'function') {
    const err = new Error('loadTenantsNeedingIdentity is required');
    emit({ ok: false, stage: 'load', error: err.message });
    return { exitCode: 1, result: { ok: false } };
  }

  const tenants = await loadTenantsNeedingIdentity();
  const provisioned = [];
  const needsManualRotate = [];
  const failed = [];

  for (const t of tenants) {
    if (flags.dryRun) {
      provisioned.push({ tenantId: t.tenantId, planned: true });
      continue;
    }
    try {
      const res = await provisionFn(t.tenantId, { credentials, secretStore, emitAudit });

      if (!res.provisioned) {
        // Idempotent: a credential already exists for this tenant.
        provisioned.push({ tenantId: t.tenantId, reused: true, userName: res.userName });
        continue;
      }

      provisioned.push({ tenantId: t.tenantId, userName: res.userName, secretRef: res.secretRef ?? null });

      if (flags.forceRotate && res.oneTimeCredential) {
        if (typeof deliverSecret === 'function') {
          await deliverSecret({
            tenantId: t.tenantId,
            userName: res.oneTimeCredential.userName,
            password: res.oneTimeCredential.password,
          });
        }
      } else {
        // No force-rotate: plaintext is intentionally not surfaced; owner must rotate.
        needsManualRotate.push(t.tenantId);
      }
    } catch (error) {
      failed.push({ tenantId: t.tenantId, code: error.code ?? 'INTERNAL_ERROR', message: error.message });
    }
  }

  const result = {
    ok: failed.length === 0,
    mode: flags.dryRun ? 'dry-run' : 'apply',
    forceRotate: flags.forceRotate,
    counts: {
      candidates: tenants.length,
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

/* c8 ignore start — thin main-guard: env/pg/Mongo wiring, exercised only on real invocation. */
async function main() {
  const { default: pg } = await import('pg');
  const { MongoClient } = await import('mongodb');
  const pool = new pg.Pool({ connectionString: process.env.PROVISIONING_DB_URL ?? process.env.DATABASE_URL });
  const mongoClient = new MongoClient(process.env.FERRETDB_ADMIN_URI ?? process.env.MONGO_URI);
  await mongoClient.connect();

  // Candidate source of truth: every active tenant should own a DocumentDB identity.
  const loadTenantsNeedingIdentity = async () => {
    const { rows } = await pool.query(
      "SELECT tenant_id FROM tenants WHERE status = 'active'",
    );
    return rows.map((r) => ({ tenantId: r.tenant_id }));
  };

  const { exitCode } = await runBackfill({
    argv: process.argv.slice(2),
    loadTenantsNeedingIdentity,
    credentials: { mongoClient },
  });
  await mongoClient.close().catch(() => {});
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
