import { MongoClient } from 'mongodb';
const uri = process.env.SPIKE_URI || 'mongodb://falcone:spikepass@localhost:27017/';
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, directConnection: true });
await client.connect();
const db = client.db('falcone_spike');
const ttl = db.collection('ttl_probe');
await ttl.drop().catch(() => {});
let name;
try { name = await ttl.createIndex({ expireAt: 1 }, { expireAfterSeconds: 5 }); }
catch (e) { console.log(JSON.stringify({ status: 'UNSUPPORTED', code: e.code, codeName: e.codeName, message: e.message })); await client.close(); process.exit(0); }
const past = new Date(Date.now() - 60000); // already expired
await ttl.insertOne({ _id: 'exp1', expireAt: past });
await ttl.insertOne({ _id: 'keep1', other: true }); // no expireAt -> never expires
const start = Date.now();
let purged = false, elapsed = null;
for (let i = 0; i < 60; i++) {            // poll up to ~180s
  const c = await ttl.countDocuments({ _id: 'exp1' });
  if (c === 0) { purged = true; elapsed = Math.round((Date.now() - start) / 1000); break; }
  await new Promise(r => setTimeout(r, 3000));
}
const keepStill = await ttl.countDocuments({ _id: 'keep1' });
console.log(JSON.stringify({ status: purged ? 'SUPPORTED' : 'PARTIAL', indexName: name, expiredDocPurged: purged, purgeElapsedSeconds: elapsed, nonExpiringDocRetained: keepStill === 1 }, null, 2));
await client.close();
