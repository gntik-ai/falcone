#!/usr/bin/env node
// Per-tenant storage-API smoke + cross-tenant negative probe against SeaweedFS
// (change add-seaweedfs-migration-validation, tasks 3.1-3.5).
//
// Drives the five live-wired storage routes (apps/control-plane/routes.mjs)
// IN-PROCESS via their handlers (the tests/env model: import the service module,
// hit live Postgres + live S3), pointing the runtime at SeaweedFS by setting
// STORAGE_S3_* before importing the handler module. For tenants A and B it asserts
// each route returns 2xx with tenant-scoped data; the cross-tenant probe asserts
// Tenant A is denied on Tenant B's bucket.
//
// Per design D3, cross-tenant denial depends on per-tenant SeaweedFS credentials
// (add-seaweedfs-tenant-identities). The live kind runtime signs with a single
// shared root credential, so the negative probe SKIPS with a logged warning unless
// PER_TENANT_S3_CREDS=1 indicates per-tenant signing is wired.
//
// Env: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY (SeaweedFS); DATABASE_URL/PG* (pg).

const ROUTES = ['storageListBuckets', 'storageProvisionBucket', 'storageWorkspaceUsage', 'storageListObjects', 'storageObjectMetadata'];

/**
 * Orchestration (pure, injectable). `callRoute(name, ctx) -> {statusCode, body}`.
 * Returns a structured result; never throws on an HTTP-level failure (records it).
 *
 * @param {object} o
 * @param {Array<{id,workspaceId,bucket,objectKey}>} o.tenants  pre-seeded tenants (A, B)
 * @param {(name:string, ctx:object)=>Promise<{statusCode:number,body?:any}>} o.callRoute
 * @param {boolean} [o.perTenantCreds=false]  whether per-tenant S3 signing is wired
 * @param {(msg:string)=>void} [o.log]
 */
export async function runSmoke({ tenants, callRoute, perTenantCreds = false, log = console.error } = {}) {
  const result = { ok: true, perTenant: [], crossTenant: null, failures: [] };
  const ok2xx = (r) => r && r.statusCode >= 200 && r.statusCode < 300;

  for (const t of tenants) {
    const routes = {};
    const ctxBase = { tenantId: t.id, callerContext: { tenantId: t.id, workspaceId: t.workspaceId } };
    const calls = [
      ['storageListBuckets', { ...ctxBase }],
      ['storageProvisionBucket', { ...ctxBase, params: { workspaceId: t.workspaceId }, body: { name: t.bucket } }],
      ['storageWorkspaceUsage', { ...ctxBase, params: { workspaceId: t.workspaceId } }],
      ['storageListObjects', { ...ctxBase, params: { bucketId: t.bucket }, query: {} }],
      ['storageObjectMetadata', { ...ctxBase, params: { bucketId: t.bucket, objectKey: encodeURIComponent(t.objectKey) } }],
    ];
    for (const [name, ctx] of calls) {
      const r = await callRoute(name, ctx);
      routes[name] = r?.statusCode ?? 0;
      if (!ok2xx(r)) { result.ok = false; result.failures.push(`${t.id}:${name}=${r?.statusCode}`); }
    }
    result.perTenant.push({ tenant: t.id, routes });
  }

  // Cross-tenant NEGATIVE probe: Tenant A on Tenant B's bucket -> must be denied.
  if (tenants.length >= 2) {
    const [a, b] = tenants;
    if (!perTenantCreds) {
      result.crossTenant = 'skipped';
      log('SKIP cross-tenant probe: per-tenant SeaweedFS credentials not wired (see add-seaweedfs-tenant-identities); set PER_TENANT_S3_CREDS=1 once issued.');
    } else {
      const probes = [
        ['storageListObjects', { tenantId: a.id, callerContext: { tenantId: a.id }, params: { bucketId: b.bucket }, query: {} }],
        ['storageObjectMetadata', { tenantId: a.id, callerContext: { tenantId: a.id }, params: { bucketId: b.bucket, objectKey: encodeURIComponent(b.objectKey) } }],
      ];
      let denied = true;
      for (const [name, ctx] of probes) {
        const r = await callRoute(name, ctx);
        if (r && (r.statusCode === 403 || r.statusCode === 404)) continue;
        denied = false; result.ok = false; result.failures.push(`cross-tenant ${name} not denied (=${r?.statusCode})`);
      }
      result.crossTenant = denied ? 'denied' : 'LEAKED';
    }
  }
  return result;
}

/* c8 ignore start — main-guard: real pg + SeaweedFS handler wiring, run via run-validation.sh. */
async function main() {
  // Point the live storage runtime at SeaweedFS BEFORE importing the handlers
  // (the module reads STORAGE_S3_* at load time).
  process.env.STORAGE_S3_ENDPOINT = process.env.S3_ENDPOINT;
  process.env.STORAGE_S3_ACCESS_KEY = process.env.S3_ACCESS_KEY ?? process.env.S3_ACCESS_KEY_ID;
  process.env.STORAGE_S3_SECRET_KEY = process.env.S3_SECRET_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
  process.env.STORAGE_S3_REGION = process.env.S3_REGION ?? 'us-east-1';

  const { default: pg } = await import('pg');
  const store = await import('../../../apps/control-plane/tenant-store.mjs');
  const { STORAGE_HANDLERS, putObject } = await import('../../../apps/control-plane/storage-handlers.mjs');

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? process.env.PG_URL });
  await store.ensureSchema(pool);

  const tenants = [
    { id: 'ten-a', workspaceId: 'wsA', bucket: 'val-ten-a-bucket', objectKey: 'probe-a.txt' },
    { id: 'ten-b', workspaceId: 'wsB', bucket: 'val-ten-b-bucket', objectKey: 'probe-b.txt' },
  ];

  // Seed tenants + workspaces (idempotent).
  for (const t of tenants) {
    await pool.query(`INSERT INTO tenants (id, slug, display_name) VALUES ($1,$1,$1) ON CONFLICT (id) DO NOTHING`, [t.id]).catch(() => {});
    await pool.query(`INSERT INTO workspaces (id, tenant_id, slug, display_name) VALUES ($1,$2,$3,$3) ON CONFLICT (id) DO NOTHING`, [t.workspaceId, t.id, t.workspaceId]);
  }

  const callRoute = (name, ctx) => STORAGE_HANDLERS[name]({ ...ctx, pool });

  // Provision a bucket + seed one object per tenant so list/metadata have data.
  for (const t of tenants) {
    await STORAGE_HANDLERS.storageProvisionBucket({ params: { workspaceId: t.workspaceId }, body: { name: t.bucket }, pool }).catch(() => {});
    await putObject(t.bucket, t.objectKey, `validation-probe-${t.id}`, 'text/plain').catch(() => {});
  }

  const result = await runSmoke({
    tenants,
    callRoute,
    perTenantCreds: process.env.PER_TENANT_S3_CREDS === '1',
  });

  // Teardown: drop provisioned bucket mappings (mirrors tests/env/down.sh intent).
  for (const t of tenants) {
    await pool.query('DELETE FROM workspace_buckets WHERE bucket_name=$1', [t.bucket]).catch(() => {});
  }
  await pool.end().catch(() => {});

  console.log(JSON.stringify(result, null, 2));
  if (result.ok) { console.error(`PASS: per-tenant storage smoke (cross-tenant: ${result.crossTenant})`); process.exit(0); }
  console.error(`FAIL: ${result.failures.join('; ')}`); process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
/* c8 ignore stop */
