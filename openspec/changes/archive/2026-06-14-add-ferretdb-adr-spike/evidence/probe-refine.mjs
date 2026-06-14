import { MongoClient } from 'mongodb';
const uri = process.env.SPIKE_URI || 'mongodb://falcone:spikepass@localhost:27017/';
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, directConnection: true });
const out = {};
function err(e) { return { codeName: e?.codeName ?? null, code: e?.code ?? null, message: (e?.message ?? String(e)).slice(0, 300) }; }
await client.connect();
const db = client.db('falcone_spike');

// --- Refine $out: does it actually materialize a collection? ---
const src = db.collection('refine_src');
await src.drop().catch(() => {});
await src.insertMany([{ tenantId: 'tA', v: 1 }, { tenantId: 'tA', v: 2 }]);
try {
  await src.aggregate([{ $match: { tenantId: 'tA' } }, { $out: 'refine_out_target' }]).toArray();
  const cnt = await db.collection('refine_out_target').countDocuments({});
  out.$out = { ferretdbAccepts: true, materializedDocs: cnt, functional: cnt === 2 };
} catch (e) { out.$out = { ferretdbAccepts: false, ...err(e) }; }

// --- Refine $merge ---
try {
  await src.aggregate([{ $match: { tenantId: 'tA' } }, { $merge: { into: 'refine_merge_target' } }]).toArray();
  const cnt = await db.collection('refine_merge_target').countDocuments({});
  out.$merge = { ferretdbAccepts: true, materializedDocs: cnt, functional: cnt === 2 };
} catch (e) { out.$merge = { ferretdbAccepts: false, ...err(e) }; }

// --- Refine text index: created -> is $text query functional? ---
const tcoll = db.collection('refine_text');
await tcoll.drop().catch(() => {});
await tcoll.insertMany([{ body: 'falcone document store' }, { body: 'unrelated content' }]);
let textIndexCreated = false, textIndexErr = null;
try { await tcoll.createIndex({ body: 'text' }); textIndexCreated = true; } catch (e) { textIndexErr = err(e); }
let listed = await tcoll.listIndexes().toArray().catch(() => []);
let textQuery = null;
try { const r = await tcoll.find({ $text: { $search: 'falcone' } }).toArray(); textQuery = { ok: true, hits: r.length }; }
catch (e) { textQuery = { ok: false, ...err(e) }; }
out.textIndex = { createAccepted: textIndexCreated, createError: textIndexErr, indexEntries: listed.map(i => i.name), textSearchQuery: textQuery };

// --- Refine geo index: created -> is $geoNear / $near functional? ---
const gcoll = db.collection('refine_geo');
await gcoll.drop().catch(() => {});
await gcoll.insertMany([{ loc: { type: 'Point', coordinates: [0, 0] } }, { loc: { type: 'Point', coordinates: [10, 10] } }]);
let geoIndexCreated = false, geoIndexErr = null;
try { await gcoll.createIndex({ loc: '2dsphere' }); geoIndexCreated = true; } catch (e) { geoIndexErr = err(e); }
let glisted = await gcoll.listIndexes().toArray().catch(() => []);
let geoNear = null;
try { const r = await gcoll.aggregate([{ $geoNear: { near: { type: 'Point', coordinates: [0, 0] }, distanceField: 'd', spherical: true } }]).toArray(); geoNear = { ok: true, rows: r.length }; }
catch (e) { geoNear = { ok: false, ...err(e) }; }
out.geoIndex = { createAccepted: geoIndexCreated, createError: geoIndexErr, indexEntries: glisted.map(i => i.name), geoNearQuery: geoNear };

// --- Refine transactions: separate truth for commit vs abort ---
const txc = db.collection('refine_tx');
await txc.deleteMany({}).catch(() => {});
async function txTrial(kind) {
  const s = client.startSession();
  const trace = {};
  try {
    s.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    await txc.insertOne({ _id: `${kind}-doc`, k: kind }, { session: s });
    if (kind === 'commit') await s.commitTransaction(); else await s.abortTransaction();
    trace.result = 'ACCEPTED';
  } catch (e) { trace.result = 'REJECTED'; trace.error = err(e); }
  finally { await s.endSession().catch(() => {}); }
  // Did the write actually persist (atomic txn) or leak (no real txn)?
  const persisted = await txc.countDocuments({ _id: `${kind}-doc` });
  trace.docPersisted = persisted === 1;
  return trace;
}
out.txCommit = await txTrial('commit');
out.txAbort = await txTrial('abort');

await client.close();
console.log(JSON.stringify(out, null, 2));
