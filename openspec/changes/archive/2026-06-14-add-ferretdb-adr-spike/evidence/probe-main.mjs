import { MongoClient } from 'mongodb';

const uri = process.env.SPIKE_URI || 'mongodb://falcone:spikepass@localhost:27017/';
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, directConnection: true });
const out = { versionPair: { ferretdb: '2.7.0', documentdb: '17-0.107.0-ferretdb-2.7.0' }, aggregation: {}, blocked: {}, mixedNumeric: {}, indexes: {}, transactions: {}, changeStreams: {} };

function classifyFromError(e) {
  return { codeName: e?.codeName ?? null, code: e?.code ?? null, message: (e?.message ?? String(e)).slice(0, 300) };
}
async function withTimeout(p, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`timeout:${label}`), { codeName: 'CLIENT_TIMEOUT' })), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

await client.connect();
const db = client.db('falcone_spike');
const coll = db.collection('agg_probe');
await coll.deleteMany({}).catch(() => {});
const other = db.collection('agg_other');
await other.deleteMany({}).catch(() => {});

await coll.insertMany([
  { _id: 1, tenantId: 'tA', category: 'x', qty: 2, price: 9.5, tags: ['a', 'b'], ref: 'r1' },
  { _id: 2, tenantId: 'tA', category: 'x', qty: 3, price: 1.25, tags: ['b', 'c'], ref: 'r2' },
  { _id: 3, tenantId: 'tA', category: 'y', qty: 5, price: 4.0, tags: ['a'], ref: 'r1' }
]);
await other.insertMany([{ key: 'r1', label: 'L1' }, { key: 'r2', label: 'L2' }]);

// ---- Task 2.1/2.2 allowed aggregation stages ----
const aggCases = {
  '$match': [{ $match: { category: 'x' } }],
  '$project': [{ $project: { category: 1, qty: 1 } }],
  '$sort': [{ $sort: { qty: 1 } }],
  '$limit': [{ $limit: 2 }],
  '$skip': [{ $skip: 1 }],
  '$group': [{ $group: { _id: '$category', total: { $sum: '$qty' } } }],
  '$unwind': [{ $unwind: '$tags' }],
  '$lookup': [{ $lookup: { from: 'agg_other', localField: 'ref', foreignField: 'key', as: 'joined' } }],
  '$count': [{ $count: 'n' }],
  '$facet': [{ $facet: { byCount: [{ $count: 'c' }], firstOne: [{ $limit: 1 }], cats: [{ $group: { _id: '$category' } }], totals: [{ $group: { _id: null, s: { $sum: '$qty' } } }] } }],
  '$addFields': [{ $addFields: { computed: { $add: ['$qty', 1] } } }],
  '$set': [{ $set: { flag: true } }],
  '$unset': [{ $unset: 'tags' }],
  '$replaceRoot': [{ $replaceRoot: { newRoot: { wrapped: '$category', q: '$qty' } } }],
  '$replaceWith': [{ $replaceWith: { only: '$category', q: '$qty' } }]
};
for (const [stage, pipeline] of Object.entries(aggCases)) {
  try {
    const rows = await withTimeout(coll.aggregate(pipeline).toArray(), 8000, stage);
    out.aggregation[stage] = { status: 'SUPPORTED', rowCount: rows.length, sample: rows[0] ?? null };
  } catch (e) {
    out.aggregation[stage] = { status: 'UNSUPPORTED', ...classifyFromError(e) };
  }
}

// ---- Task 2.3 blocked stages ----
const blockedCases = {
  '$out': [{ $out: 'agg_dump' }],
  '$merge': [{ $merge: { into: 'agg_merge' } }],
  '$geoNear': [{ $geoNear: { near: { type: 'Point', coordinates: [0, 0] }, distanceField: 'dist', spherical: true } }]
};
for (const [stage, pipeline] of Object.entries(blockedCases)) {
  try {
    await withTimeout(coll.aggregate(pipeline).toArray(), 8000, stage);
    out.blocked[stage] = { status: 'SUPPORTED', note: 'executed without error (unexpected)' };
  } catch (e) {
    out.blocked[stage] = { status: 'UNSUPPORTED', ...classifyFromError(e) };
  }
}

// ---- Task 2.4 $group with $sum/$avg over mixed numeric types ----
const mix = db.collection('mixed_numeric');
await mix.deleteMany({}).catch(() => {});
await mix.insertMany([{ val: 1 }, { val: 2.5 }, { val: 3 }, { val: 4.5 }]); // int + double mix; sum=11 avg=2.75
try {
  const r = await mix.aggregate([{ $group: { _id: null, sum: { $sum: '$val' }, avg: { $avg: '$val' } } }]).toArray();
  const sum = r[0]?.sum, avg = r[0]?.avg;
  out.mixedNumeric = { status: (sum === 11 && Math.abs(avg - 2.75) < 1e-9) ? 'SUPPORTED' : 'PARTIAL', sum, avg, expected: { sum: 11, avg: 2.75 } };
} catch (e) {
  out.mixedNumeric = { status: 'UNSUPPORTED', ...classifyFromError(e) };
}

// ---- Task 3 indexes ----
const idx = db.collection('idx_probe');
await idx.drop().catch(() => {});
await idx.insertMany([{ a: 1, b: 1, u: 'k1' }, { a: 2, b: 2, u: 'k2' }]);
// 3.1 single
try { const n = await idx.createIndex({ a: 1 }); out.indexes.single = { status: 'SUPPORTED', name: n }; } catch (e) { out.indexes.single = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
// 3.2 compound
try { const n = await idx.createIndex({ a: 1, b: -1 }); out.indexes.compound = { status: 'SUPPORTED', name: n }; } catch (e) { out.indexes.compound = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
// 3.3 unique + collision
try {
  const n = await idx.createIndex({ u: 1 }, { unique: true });
  let enforced = false, errEvidence = null;
  try { await idx.insertOne({ a: 9, b: 9, u: 'k1' }); } catch (e2) { enforced = true; errEvidence = classifyFromError(e2); }
  out.indexes.unique = { status: enforced ? 'SUPPORTED' : 'PARTIAL', name: n, collisionEnforced: enforced, collisionError: errEvidence };
} catch (e) { out.indexes.unique = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
// 3.4 sparse (unique+sparse: two docs missing field must NOT collide)
const sp = db.collection('sparse_probe');
await sp.drop().catch(() => {});
try {
  const n = await sp.createIndex({ s: 1 }, { unique: true, sparse: true });
  await sp.insertOne({ _id: 1, other: 1 });           // missing s
  let secondOk = true, errEvidence = null;
  try { await sp.insertOne({ _id: 2, other: 2 }); } catch (e2) { secondOk = false; errEvidence = classifyFromError(e2); }
  out.indexes.sparse = { status: secondOk ? 'SUPPORTED' : 'PARTIAL', name: n, missingFieldDocsCoexist: secondOk, error: errEvidence };
} catch (e) { out.indexes.sparse = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
// 3.6 text + geo (expected UNSUPPORTED)
const tg = db.collection('textgeo_probe');
await tg.drop().catch(() => {});
await tg.insertOne({ body: 'hello world', loc: { type: 'Point', coordinates: [0, 0] } });
try { await tg.createIndex({ body: 'text' }); out.indexes.text = { status: 'SUPPORTED', note: 'created (unexpected)' }; } catch (e) { out.indexes.text = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
try { await tg.createIndex({ loc: '2dsphere' }); out.indexes.geo = { status: 'SUPPORTED', note: 'created (unexpected)' }; } catch (e) { out.indexes.geo = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }

// ---- Task 4 transactions ----
const txColl = db.collection('tx_probe');
await txColl.deleteMany({}).catch(() => {});
// 4.1 commit
{
  const session = client.startSession();
  try {
    session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    await txColl.insertOne({ _id: 'c1', v: 1 }, { session });
    await withTimeout(session.commitTransaction(), 8000, 'commitTransaction');
    out.transactions.commit = { status: 'SUPPORTED' };
  } catch (e) { out.transactions.commit = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
  finally { await session.endSession().catch(() => {}); }
}
// 4.2 abort
{
  const session = client.startSession();
  try {
    session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    await txColl.insertOne({ _id: 'a1', v: 1 }, { session });
    await withTimeout(session.abortTransaction(), 8000, 'abortTransaction');
    out.transactions.abort = { status: 'SUPPORTED' };
  } catch (e) { out.transactions.abort = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
  finally { await session.endSession().catch(() => {}); }
}

// ---- Task 5 change streams ----
const csColl = db.collection('cs_probe');
await csColl.deleteMany({}).catch(() => {});
// 5.2 pre-image enablement (collMod) as realtime-executor.mjs does
try {
  const r = await db.command({ collMod: 'cs_probe', changeStreamPreAndPostImages: { enabled: true } });
  out.changeStreams.preImageCollMod = { status: 'SUPPORTED', ok: r.ok };
} catch (e) { out.changeStreams.preImageCollMod = { status: 'UNSUPPORTED', ...classifyFromError(e) }; }
// 5.1 realtime-executor pipeline watch()
const rtPipeline = [{ $match: { $or: [
  { operationType: { $in: ['insert', 'update', 'replace'] }, 'fullDocument.tenantId': 'tA' },
  { operationType: 'delete', 'fullDocumentBeforeChange.tenantId': 'tA' }
] } }];
try {
  const stream = csColl.watch(rtPipeline, { fullDocument: 'updateLookup', fullDocumentBeforeChange: 'whenAvailable' });
  try {
    await withTimeout(stream.tryNext(), 6000, 'watch.tryNext');
    out.changeStreams.realtimeWatch = { status: 'SUPPORTED', note: 'stream opened and tryNext returned' };
  } catch (e) {
    out.changeStreams.realtimeWatch = { status: 'UNSUPPORTED', phase: 'iterate', ...classifyFromError(e) };
  } finally { await stream.close().catch(() => {}); }
} catch (e) {
  out.changeStreams.realtimeWatch = { status: 'UNSUPPORTED', phase: 'open', ...classifyFromError(e) };
}
// 5.3 CDC bridge pattern (resumeAfter/startAtOperationTime)
const cdcPipeline = [{ $match: { operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } }];
try {
  const stream = csColl.watch(cdcPipeline, { fullDocument: 'updateLookup', startAtOperationTime: undefined });
  try {
    await withTimeout(stream.tryNext(), 6000, 'cdc.tryNext');
    out.changeStreams.cdcWatch = { status: 'SUPPORTED', note: 'stream opened and tryNext returned' };
  } catch (e) {
    out.changeStreams.cdcWatch = { status: 'UNSUPPORTED', phase: 'iterate', ...classifyFromError(e) };
  } finally { await stream.close().catch(() => {}); }
} catch (e) {
  out.changeStreams.cdcWatch = { status: 'UNSUPPORTED', phase: 'open', ...classifyFromError(e) };
}

await client.close();
console.log(JSON.stringify(out, null, 2));
