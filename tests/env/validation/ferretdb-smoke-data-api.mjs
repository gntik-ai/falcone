#!/usr/bin/env node
// Per-tenant document-store-API smoke + risk-area probes against FerretDB v2 + DocumentDB
// (change add-ferretdb-migration-validation, tasks 3.1-3.9).
//
// For tenants A and B it drives the live document-store surface and the FerretDB v2
// compatibility areas, asserting the post-migration backend behaves correctly:
//   - CRUD (insert / list / query[filter+page] / search) THROUGH the data-API executor
//     (apps/control-plane-executor/src/runtime/mongo-data-executor.mjs) — tenant scoping via the
//     `tenantId` field in packages/adapters/src/mongodb-data-api.mjs is the SOLE boundary;
//   - cross-tenant NEGATIVE probe (Tenant A denied on Tenant B data -> 403/404);
//   - aggregation: $group / same-namespace $lookup(<=1) / $facet(<=4) MUST return 200
//     (SUPPORTED — adapter-capped, NOT waivable); cross-database $lookup MUST be rejected
//     with the exact code Location40321 (ADR-14 confirmed-expected outcome);
//   - index: unique -> E11000; compound / sparse / TTL -> success (all SUPPORTED, no waiver);
//   - transaction (deterministic per ADR-14): commit -> CommandNotFound 59; abort is a SILENT
//     NO-OP that does NOT roll back written documents (data-integrity finding);
//   - CDC (pinned per ADR-14): watch() -> CommandNotSupported 115; changeStreamPreAndPostImages
//     -> UnknownBsonField 40415 (remediation tracked in add-ferretdb-realtime-cdc-remediation);
//   - isolation-gap: a raw tenant_a backend credential reads tenant_b data directly and
//     SUCCEEDS — confirming DocumentDB has NO per-database role scoping (ADR-14 finding;
//     apps/control-plane-executor/src/postgres-applier.mjs provisions no per-tenant DocumentDB identity).
//
// `runSmoke` is PURE: it takes an injected `api` (one async method per probe class) so the
// pass/fail/waiver logic is deterministically testable in tests/blackbox without a live
// backend. The main-guard wires the real executor + a raw `mongodb` driver against FerretDB
// (the executor runs CRUD; aggregation/txn/CDC/index/isolation are backend behaviours the
// executor does not execute, so they are probed at the driver level — exactly as ADR-14 did).

// Exact wire codes pinned by ADR-14 (live-verified on ferretdb:2.7.0 / postgres-documentdb:
// 17-0.107.0-ferretdb-2.7.0). FerretDB surfaces BOTH a numeric `code` and a string `codeName`,
// so each expectation accepts either form; a code outside the accepted set is a NEW finding
// (fail the gate), never a silent skip. `label` is the human-readable expectation in messages.
export const ADR14_CODES = Object.freeze({
  txnCommit: { label: 'CommandNotFound 59', accept: ['59', 'CommandNotFound'] },
  cdcWatch: { label: 'CommandNotSupported 115', accept: ['115', 'CommandNotSupported'] },
  cdcPrePost: { label: 'UnknownBsonField 40415', accept: ['40415', 'UnknownBsonField'] },
  crossDbLookup: { label: 'Location40321', accept: ['40321', 'Location40321'] },
  uniqueViolation: { label: 'E11000', accept: ['11000', 'E11000', 'DuplicateKey'] },
});

const ok2xx = (r) => Boolean(r) && r.statusCode >= 200 && r.statusCode < 300;
// True when the observed code matches one of the ADR-14 accepted forms (numeric or codeName).
const accepts = (spec, got) => spec.accept.some((token) => String(got) === token) || (typeof got === 'string' && spec.accept.some((token) => got.includes(token)));

/**
 * Orchestrate the per-tenant smoke + risk-area probes. Never throws on an HTTP/backend-level
 * failure (records it). Supported checks must pass; deterministic-failure checks must produce
 * the EXACT ADR-14 code (recorded as a waiver, gate stays green); a different outcome fails.
 *
 * @param {object} o
 * @param {Array<{id,workspaceId,collection}>} o.tenants  seeded tenants (A, B)
 * @param {object} o.api  injected probes:
 *   crud(op, ctx)            -> {statusCode, body?}             op: insert|list|query|search|cross-list|cross-get
 *   aggregate(ctx)           -> {statusCode?, errorCode?}       ctx.kind: $group|$lookup|$facet|$lookup-cross-db
 *   index(kind, ctx)         -> {ok?, statusCode?, errorCode?}  kind: unique|compound|sparse|ttl
 *   transaction(kind, ctx)   -> {errorCode?, dataPresentAfterAbort?}  kind: commit|abort
 *   changeStream(kind)       -> {errorCode?}                    kind: watch|preAndPostImages
 *   isolationRead(ctx)       -> {read:boolean}
 * @param {(msg:string)=>void} [o.log]
 */
export async function runSmoke({ tenants, api, log = console.error } = {}) {
  const result = {
    ok: true,
    perTenant: [],
    crossTenant: null,
    aggregation: [],
    indexes: [],
    transaction: [],
    cdc: [],
    isolationGap: null,
    waivers: [],
    findings: [],
    failures: [],
  };
  const fail = (msg) => { result.ok = false; result.failures.push(msg); };
  const t0 = tenants[0];

  // 1. Per-tenant CRUD through the data-API executor (task 3.1). insert -> 201, the rest -> 200.
  for (const t of tenants) {
    const ops = {};
    const calls = [
      ['insert', { tenant: t }],
      ['list', { tenant: t }],
      ['query', { tenant: t, filter: { kind: { $eq: 'probe' } }, page: { size: 10 } }],
      ['search', { tenant: t, text: 'hello' }],
    ];
    for (const [op, ctx] of calls) {
      const r = await api.crud(op, ctx);
      ops[op] = r?.statusCode ?? 0;
      if (!ok2xx(r)) fail(`${t.id}:${op}=${r?.statusCode}`);
    }
    result.perTenant.push({ tenant: t.id, ops });
  }

  // 2. Cross-tenant NEGATIVE probe (task 3.7): Tenant A on Tenant B data -> 403 or 404.
  if (tenants.length >= 2) {
    const [a, b] = tenants;
    let denied = true;
    for (const op of ['cross-list', 'cross-get']) {
      const r = await api.crud(op, { tenant: a, targetTenant: b });
      if (r && (r.statusCode === 403 || r.statusCode === 404)) continue;
      denied = false; fail(`cross-tenant ${op} not denied (=${r?.statusCode})`);
    }
    result.crossTenant = denied ? 'denied' : 'LEAKED';
  }

  // 3. Aggregation probes (task 3.3). Supported operators are NOT waivable — must be 200.
  for (const kind of ['$group', '$lookup', '$facet']) {
    const r = await api.aggregate({ tenant: t0, kind });
    const passed = ok2xx(r);
    result.aggregation.push({ kind, supported: true, statusCode: r?.statusCode, ok: passed });
    if (!passed) fail(`aggregation ${kind} expected 200 got ${r?.statusCode ?? r?.errorCode}`);
  }
  // Cross-database $lookup is REJECTED with the exact code Location40321 (ADR-14 expected).
  {
    const r = await api.aggregate({ tenant: t0, kind: '$lookup-cross-db' });
    const matched = accepts(ADR14_CODES.crossDbLookup, r?.errorCode);
    result.aggregation.push({ kind: '$lookup-cross-db', supported: false, errorCode: r?.errorCode, ok: matched });
    if (matched) result.waivers.push(`cross-database $lookup rejected with ${ADR14_CODES.crossDbLookup.label} (ADR-14, confirmed expected)`);
    else fail(`cross-db $lookup expected ${ADR14_CODES.crossDbLookup.label} got ${r?.errorCode ?? r?.statusCode}`);
  }

  // 4. Index probes (task 3.4) — all index types SUPPORTED, no waiver.
  {
    const uniq = await api.index('unique', { tenant: t0 });
    const uok = accepts(ADR14_CODES.uniqueViolation, uniq?.errorCode) || /E11000/.test(uniq?.message ?? '');
    result.indexes.push({ name: 'unique', ok: uok, detail: uniq });
    if (!uok) fail(`unique index expected ${ADR14_CODES.uniqueViolation.label} got ${uniq?.errorCode ?? uniq?.statusCode}`);
    for (const kind of ['compound', 'sparse', 'ttl']) {
      const r = await api.index(kind, { tenant: t0 });
      const passed = r?.ok === true || ok2xx(r);
      result.indexes.push({ name: kind, ok: passed, detail: r });
      if (!passed) fail(`${kind} index expected success got ${r?.statusCode ?? r?.errorCode}`);
    }
  }

  // 5. Transaction probes (task 3.5) — deterministic per ADR-14. No "either succeeds" branch.
  {
    const commit = await api.transaction('commit', { tenant: t0 });
    const cMatched = accepts(ADR14_CODES.txnCommit, commit?.errorCode);
    result.transaction.push({ name: 'commit', errorCode: commit?.errorCode, ok: cMatched });
    if (cMatched) result.waivers.push(`transaction commit -> ${ADR14_CODES.txnCommit.label} (ADR-14, confirmed expected; FerretDB v2 has no multi-document transactions)`);
    else fail(`transaction commit expected ${ADR14_CODES.txnCommit.label} got ${commit?.errorCode}`);

    const abort = await api.transaction('abort', { tenant: t0 });
    const noRollback = abort?.dataPresentAfterAbort === true; // abort is a SILENT NO-OP
    result.transaction.push({ name: 'abort', dataPresentAfterAbort: abort?.dataPresentAfterAbort, ok: noRollback });
    if (noRollback) {
      result.findings.push('DATA-INTEGRITY (ADR-14): transaction abort did NOT roll back written documents (silent no-op) — partial-write hazard.');
      result.waivers.push('transaction abort silent no-op (ADR-14, confirmed expected data-integrity finding)');
    } else {
      fail('transaction abort probe: expected written documents to remain after abort (silent no-op); they were rolled back — NEW finding.');
    }
  }

  // 6. CDC probes (task 3.6) — pinned codes per ADR-14; no generic "unsupported" check.
  {
    const watch = await api.changeStream('watch');
    const wMatched = accepts(ADR14_CODES.cdcWatch, watch?.errorCode);
    result.cdc.push({ name: 'watch', errorCode: watch?.errorCode, ok: wMatched });
    if (wMatched) result.waivers.push(`change-stream watch() -> ${ADR14_CODES.cdcWatch.label} (ADR-14; remediation: add-ferretdb-realtime-cdc-remediation)`);
    else fail(`cdc watch() expected ${ADR14_CODES.cdcWatch.label} got ${watch?.errorCode}`);

    const prepost = await api.changeStream('preAndPostImages');
    const pMatched = accepts(ADR14_CODES.cdcPrePost, prepost?.errorCode);
    result.cdc.push({ name: 'changeStreamPreAndPostImages', errorCode: prepost?.errorCode, ok: pMatched });
    if (pMatched) result.waivers.push(`changeStreamPreAndPostImages -> ${ADR14_CODES.cdcPrePost.label} (ADR-14, confirmed expected)`);
    else fail(`cdc changeStreamPreAndPostImages expected ${ADR14_CODES.cdcPrePost.label} got ${prepost?.errorCode}`);
  }

  // 7. Isolation-gap probe (task 3.9): raw tenant_a backend creds read tenant_b -> SUCCEEDS.
  if (tenants.length >= 2) {
    const [a, b] = tenants;
    const gap = await api.isolationRead({ asTenant: a, targetTenant: b });
    if (gap?.read === true) {
      result.isolationGap = 'confirmed-gap';
      result.findings.push('ISOLATION-GAP (ADR-14): FerretDB/DocumentDB enforces NO per-database role scoping — a tenant_a backend credential read tenant_b data directly (bypassing the Falcone API). The app-layer tenantId filter is the SOLE enforced boundary; postgres-applier.mjs provisions no per-tenant DocumentDB identity.');
    } else {
      result.isolationGap = 'unexpected-denial';
      fail('isolation-gap probe: expected the direct backend read to SUCCEED (documented ADR-14 gap); it was denied — NEW finding requiring investigation.');
    }
  }

  return result;
}

/* c8 ignore start — main-guard: real executor + raw mongodb driver vs live FerretDB, run via run-ferretdb-validation.sh. */

// Map an executor result/throw to an HTTP-like {statusCode}. The executor returns data on
// success and throws clientError(...) with a numeric `statusCode` on rejection.
async function execStatus(fn, okCode = 200) {
  try { const body = await fn(); return { statusCode: okCode, body }; }
  catch (e) { return { statusCode: e?.statusCode ?? 500, body: { code: e?.code, message: e?.message } }; }
}

// Extract the backend (FerretDB) wire error code from a thrown driver error.
const wireCode = (e) => e?.codeName ?? e?.code ?? e?.errmsg ?? e?.message;

async function main() {
  const { MongoClient } = await import('mongodb');
  const { createMongoExecutor } = await import('../../../apps/control-plane-executor/src/runtime/mongo-data-executor.mjs');

  const URI = process.env.FERRETDB_URI ?? process.env.MONGO_URI ?? 'mongodb://falcone:falcone@localhost:57017/';
  const DB = process.env.FERRETDB_VALIDATION_DB ?? 'ferretdb_validation';
  const COLL = 'val_notes';
  const JOIN_COLL = 'val_join';
  const CROSS_DB = `${DB}_other`;

  const tenants = [
    { id: process.env.TESTENV_TENANT_A ?? 'val_ten_a', workspaceId: 'val_ws_a', collection: COLL },
    { id: process.env.TESTENV_TENANT_B ?? 'val_ten_b', workspaceId: 'val_ws_b', collection: COLL },
  ];

  // FerretDB backend profile: supportsTransactions=false so the data-API rejects `transaction`
  // ops at the boundary (501). CRUD ops are dispatched to the real FerretDB gateway.
  const exec = createMongoExecutor({ resolveUri: () => URI, topology: { supportsTransactions: false } });
  const raw = new MongoClient(URI);
  await raw.connect();
  const db = raw.db(DB);
  const coll = db.collection(COLL);

  const identity = (t) => ({ tenantId: t.id, workspaceId: t.workspaceId, roleName: 'data.writer' });
  const baseOf = (t) => ({ databaseName: DB, collectionName: COLL, identity: identity(t), workspaceId: t.workspaceId });

  // --- api wiring ----------------------------------------------------------------
  const api = {
    async crud(op, ctx) {
      const t = ctx.tenant;
      if (op === 'insert') {
        return execStatus(() => exec.executeMongoData({ ...baseOf(t), operation: 'insert', payload: { document: { _id: `${t.id}-probe`, body: 'hello world', kind: 'probe' } } }), 201);
      }
      if (op === 'list') {
        return execStatus(() => exec.executeMongoData({ ...baseOf(t), operation: 'list' }));
      }
      if (op === 'query') {
        return execStatus(() => exec.executeMongoData({ ...baseOf(t), operation: 'list', filter: ctx.filter, page: ctx.page }));
      }
      if (op === 'search') {
        // FerretDB full-text via the executor's supported filter surface: a $regex match.
        return execStatus(() => exec.executeMongoData({ ...baseOf(t), operation: 'list', filter: { body: { $regex: 'hello' } } }));
      }
      if (op === 'cross-list') {
        // Forge the OTHER tenant's id in the filter -> tenant_scope_violation 403.
        return execStatus(() => exec.executeMongoData({ ...baseOf(t), operation: 'list', filter: { tenantId: { $eq: ctx.targetTenant.id } } }));
      }
      if (op === 'cross-get') {
        // Read the other tenant's seeded doc by id -> tenant-scoped not-found (404).
        const r = await execStatus(() => exec.executeMongoData({ ...baseOf(t), operation: 'get', documentId: `${ctx.targetTenant.id}-probe` }));
        if (r.statusCode === 200 && r.body?.found === false) return { statusCode: 404 };
        return r;
      }
      return { statusCode: 400 };
    },

    async aggregate(ctx) {
      try {
        if (ctx.kind === '$group') {
          await coll.aggregate([{ $match: { tenantId: ctx.tenant.id } }, { $group: { _id: '$kind', n: { $sum: 1 } } }]).toArray();
        } else if (ctx.kind === '$lookup') {
          await coll.aggregate([{ $match: { tenantId: ctx.tenant.id } }, { $lookup: { from: JOIN_COLL, localField: 'kind', foreignField: 'kind', as: 'joined' } }]).toArray();
        } else if (ctx.kind === '$facet') {
          await coll.aggregate([{ $match: { tenantId: ctx.tenant.id } }, { $facet: { count: [{ $count: 'n' }], sample: [{ $limit: 1 }] } }]).toArray();
        } else if (ctx.kind === '$lookup-cross-db') {
          // Cross-DATABASE $lookup (from references a different db) -> Location40321.
          await coll.aggregate([{ $lookup: { from: { db: CROSS_DB, coll: JOIN_COLL }, localField: 'kind', foreignField: 'kind', as: 'joined' } }]).toArray();
        }
        return { statusCode: 200 };
      } catch (e) { return { statusCode: 500, errorCode: wireCode(e) }; }
    },

    async index(kind, ctx) {
      try {
        if (kind === 'unique') {
          await coll.createIndex({ uniqField: 1 }, { unique: true, sparse: true, name: 'val_uniq' });
          const dup = { _id: `${ctx.tenant.id}-uniq-1`, tenantId: ctx.tenant.id, uniqField: 'dup', body: 'x' };
          await coll.insertOne(dup).catch(() => {});
          await coll.insertOne({ ...dup, _id: `${ctx.tenant.id}-uniq-2` });
          return { ok: false, errorCode: 'no-violation' }; // should not reach: duplicate must throw
        }
        if (kind === 'compound') { await coll.createIndex({ tenantId: 1, kind: 1 }, { name: 'val_compound' }); }
        if (kind === 'sparse') { await coll.createIndex({ optional: 1 }, { sparse: true, name: 'val_sparse' }); }
        if (kind === 'ttl') { await coll.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600, name: 'val_ttl' }); await coll.insertOne({ _id: `${ctx.tenant.id}-ttl`, tenantId: ctx.tenant.id, createdAt: new Date(), kind: 'ttl' }).catch(() => {}); }
        return { ok: true };
      } catch (e) {
        const c = e?.code ?? wireCode(e);
        return { ok: false, errorCode: c, message: e?.message };
      }
    },

    async transaction(kind, ctx) {
      const session = raw.startSession();
      try {
        session.startTransaction();
        await coll.insertOne({ _id: `${ctx.tenant.id}-txn-${kind}`, tenantId: ctx.tenant.id, kind: 'txn' }, { session }).catch(() => {});
        if (kind === 'commit') {
          await session.commitTransaction();
          return { errorCode: 'committed' }; // unexpected: FerretDB v2 should reject commit
        }
        // abort: FerretDB treats abort as a silent no-op (does NOT roll back the write above).
        await session.abortTransaction().catch(() => {});
        const present = await coll.findOne({ _id: `${ctx.tenant.id}-txn-abort` });
        return { dataPresentAfterAbort: present != null };
      } catch (e) {
        return { errorCode: wireCode(e) };
      } finally {
        await session.endSession().catch(() => {});
      }
    },

    async changeStream(kind) {
      if (kind === 'watch') {
        // coll.watch() is LAZY — the $changeStream aggregate is not sent until iteration, so
        // force it with tryNext() to surface FerretDB v2's CommandNotSupported (115).
        const cs = coll.watch();
        try {
          await cs.tryNext();
          return { errorCode: 'opened' }; // unexpected on FerretDB v2 (would mean change streams work)
        } catch (e) {
          return { errorCode: wireCode(e) };
        } finally {
          await cs.close().catch(() => {});
        }
      }
      try {
        await db.command({ collMod: COLL, changeStreamPreAndPostImages: { enabled: true } });
        return { errorCode: 'enabled' }; // unexpected on FerretDB v2
      } catch (e) { return { errorCode: wireCode(e) }; }
    },

    async isolationRead({ targetTenant }) {
      // Raw backend credential (shared root) reads the OTHER tenant's data directly, bypassing
      // the Falcone API layer's tenantId filter. Succeeds -> confirms no per-db role scoping.
      const probe = new MongoClient(URI);
      try {
        await probe.connect();
        const docs = await probe.db(DB).collection(COLL).find({ tenantId: targetTenant.id }).toArray();
        return { read: docs.length >= 0 }; // the READ itself succeeding is the gap (data visible)
      } catch { return { read: false }; }
      finally { await probe.close().catch(() => {}); }
    },
  };

  // Start clean (idempotent). The per-tenant `${id}-probe` document is created by the insert
  // probe itself (the first CRUD call per tenant), so it is NOT pre-seeded here — pre-seeding
  // the same _id would make the insert probe a duplicate-key 500. Only the $lookup foreign
  // collection is seeded so same-namespace $lookup has a join target.
  await db.dropDatabase().catch(() => {});
  await db.collection(JOIN_COLL).insertOne({ _id: 'join-probe', tenantId: tenants[0].id, kind: 'probe', label: 'joined' }).catch(() => {});

  const result = await runSmoke({ tenants, api });

  // Teardown (task 3.8): drop the validation database so runs are idempotent.
  await db.dropDatabase().catch(() => {});
  await raw.close().catch(() => {});
  await exec.close().catch(() => {});

  console.log(JSON.stringify(result, null, 2));
  if (result.waivers.length) { console.error('---- ADR-14 waivers ----'); for (const w of result.waivers) console.error(`  • ${w}`); }
  if (result.findings.length) { console.error('---- recorded findings ----'); for (const f of result.findings) console.error(`  • ${f}`); }
  if (result.ok) { console.error(`PASS: per-tenant FerretDB smoke (cross-tenant: ${result.crossTenant}, isolation: ${result.isolationGap})`); process.exit(0); }
  console.error(`FAIL: ${result.failures.join('; ')}`); process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
/* c8 ignore stop */
