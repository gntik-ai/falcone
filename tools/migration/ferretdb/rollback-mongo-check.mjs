#!/usr/bin/env node
// rollback-mongo-check.mjs — MongoDB-side validation gate for the FerretDB->MongoDB rollback
// (add-ferretdb-rollback-plan #463, tasks 4.4-4.6). Runs AFTER the data-API plane is re-pointed
// to MongoDB and the pre-#460 change-stream image is redeployed.
//
// Two checks, both of which PASS on MongoDB and would FAIL on FerretDB (which is the point —
// this gate proves the rollback target really is MongoDB):
//   1. Per-tenant data-API smoke: insert/list for tenants A and B through the data-API executor;
//      a cross-tenant read returns not-found (tenant isolation holds). Backend-agnostic.
//   2. MongoDB change-stream delivery: collection.watch() returns a valid cursor, an insert is
//      DELIVERED to the stream (no CommandNotSupported(115)). This only works on MongoDB — it is
//      exactly the path #460 removed from the post-cutover build, so confirming it proves the
//      pre-#460 change-stream image is running against a real MongoDB.
//
// Env: ROLLBACK_MONGO_URI (the MongoDB endpoint to validate). Requires a replica-set MongoDB for
// the change-stream check. Exits 0 only when BOTH checks pass.

// Pure gate decision (testable): pass only when the data-API smoke is ok, cross-tenant access is
// denied, and a change-stream event was delivered.
export function evaluateGate({ smokeOk, crossTenantDenied, changeDelivered } = {}) {
  const failures = [];
  if (!smokeOk) failures.push('per-tenant data-API smoke failed');
  if (!crossTenantDenied) failures.push('cross-tenant read was NOT denied');
  if (!changeDelivered) failures.push('MongoDB change-stream event was NOT delivered (collection.watch)');
  return { ok: failures.length === 0, failures };
}

/* c8 ignore start — main-guard: real MongoClient + executor against a live MongoDB, run via rollback-validate.sh. */
async function main() {
  const URI = process.env.ROLLBACK_MONGO_URI;
  if (!URI) { console.error('FATAL: set ROLLBACK_MONGO_URI (the MongoDB endpoint to validate the rollback against)'); process.exit(2); }

  const { MongoClient } = await import('mongodb');
  const { createMongoExecutor } = await import('../../../apps/control-plane-executor/src/runtime/mongo-data-executor.mjs');

  const DB = process.env.ROLLBACK_VALIDATION_DB ?? 'rollback_validation';
  const COLL = 'rb_notes';
  const tenants = [
    { id: 'rb_ten_a', workspaceId: 'rb_ws_a' },
    { id: 'rb_ten_b', workspaceId: 'rb_ws_b' },
  ];
  const identity = (t) => ({ tenantId: t.id, workspaceId: t.workspaceId, roleName: 'data.writer' });
  const base = (t) => ({ databaseName: DB, collectionName: COLL, identity: identity(t), workspaceId: t.workspaceId });

  // MongoDB supports transactions, so do NOT pass supportsTransactions:false here.
  const exec = createMongoExecutor({ resolveUri: () => URI });
  const raw = new MongoClient(URI);
  await raw.connect();
  const coll = raw.db(DB).collection(COLL);
  await raw.db(DB).dropDatabase().catch(() => {});

  let smokeOk = true;
  let crossTenantDenied = false;
  let changeDelivered = false;
  try {
    // 1. Per-tenant data-API smoke (insert + list), tenant-scoped.
    for (const t of tenants) {
      await exec.executeMongoData({ ...base(t), operation: 'insert', payload: { document: { _id: `${t.id}-doc`, body: 'rollback-probe' } } });
      const listed = await exec.executeMongoData({ ...base(t), operation: 'list' });
      if (!listed.items.every((d) => d.tenantId === t.id) || listed.items.length !== 1) smokeOk = false;
    }
    // cross-tenant: tenant A reads tenant B's doc by id -> not found.
    const cross = await exec.executeMongoData({ ...base(tenants[0]), operation: 'get', documentId: `${tenants[1].id}-doc` });
    crossTenantDenied = cross.found === false;

    // 2. MongoDB change-stream delivery: watch, insert, receive.
    const cs = coll.watch();
    try {
      const got = new Promise((resolve) => {
        cs.on('change', (ev) => { if (ev.operationType === 'insert') resolve(true); });
      });
      // Establish the change stream (run the $changeStream aggregate, set the resume point) BEFORE
      // inserting — else the insert can land before the start point and the event is missed.
      // (Verified on the kind test cluster: without this wait the gate spuriously reports
      // changeDelivered:false against a healthy replica-set MongoDB.)
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 10000));
      await coll.insertOne({ _id: 'cs-probe', tenantId: tenants[0].id, body: 'watch' });
      changeDelivered = await Promise.race([got, timeout]);
    } finally {
      await cs.close().catch(() => {});
    }
  } catch (e) {
    console.error(`ERROR during gate: ${e.message}`);
    smokeOk = false;
  } finally {
    await raw.db(DB).dropDatabase().catch(() => {});
    await raw.close().catch(() => {});
    await exec.close().catch(() => {});
  }

  const gate = evaluateGate({ smokeOk, crossTenantDenied, changeDelivered });
  console.log(JSON.stringify({ smokeOk, crossTenantDenied, changeDelivered, ...gate }, null, 2));
  if (gate.ok) { console.error('PASS: MongoDB rollback gate (data-API smoke + change-stream delivery)'); process.exit(0); }
  console.error(`FAIL: ${gate.failures.join('; ')}`); process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
/* c8 ignore stop */
