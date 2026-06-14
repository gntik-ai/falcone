import { MongoClient } from 'mongodb';
const base = process.env.SPIKE_URI || 'mongodb://falcone:spikepass@localhost:27017/';
function err(e) { return { codeName: e?.codeName ?? null, code: e?.code ?? null, message: (e?.message ?? String(e)).slice(0, 300) }; }
const out = {};

// Bootstrap (superuser) connection
const admin = new MongoClient(base, { directConnection: true, serverSelectionTimeoutMS: 8000 });
await admin.connect();

// 7.1 cross-database visibility from a single connection (namespace isolation, app-level)
try {
  const aCount = await admin.db('tenant_a').collection('docs').countDocuments({});
  // attempt cross-db $lookup from tenant_a into tenant_b (cross-db join)
  let crossDbLookup;
  try {
    const r = await admin.db('tenant_a').collection('docs').aggregate([
      { $lookup: { from: { db: 'tenant_b', coll: 'docs' }, localField: 'tenantId', foreignField: 'missing', as: 'x' } }
    ]).toArray();
    crossDbLookup = { accepted: true, rows: r.length };
  } catch (e) { crossDbLookup = { accepted: false, ...err(e) }; }
  out.namespaceIsolation = { tenantADocs: aCount, crossDbLookup };
} catch (e) { out.namespaceIsolation = err(e); }

// 7.2 create a per-tenant user scoped to tenant_a only, test authn + authz scoping
let createUserResult;
try {
  const r = await admin.db('tenant_a').command({
    createUser: 'tenant_a_user',
    pwd: 'tenantApass1',
    roles: [{ role: 'readWrite', db: 'tenant_a' }]
  });
  createUserResult = { ok: r.ok };
} catch (e) { createUserResult = err(e); }
out.createScopedUser = createUserResult;

// also a cluster-wide user for comparison
let createAnyUser;
try {
  const r = await admin.db('admin').command({
    createUser: 'tenant_any_user', pwd: 'anyPass1', roles: [{ role: 'readWriteAnyDatabase', db: 'admin' }]
  });
  createAnyUser = { ok: r.ok };
} catch (e) { createAnyUser = err(e); }
out.createAnyUser = createAnyUser;

await admin.close();

// 7.2 authenticate as the scoped user and test own-db vs cross-tenant access
async function asUser(user, pwd, authDb) {
  const uri = `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pwd)}@localhost:27017/?authSource=${authDb}`;
  const c = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 8000 });
  const trace = { connected: false };
  try {
    await c.connect();
    await c.db(authDb).command({ ping: 1 });
    trace.connected = true;
    try { trace.ownDbRead = { ok: true, count: await c.db('tenant_a').collection('docs').countDocuments({}) }; }
    catch (e) { trace.ownDbRead = { ok: false, ...err(e) }; }
    try { trace.crossTenantRead = { ok: true, count: await c.db('tenant_b').collection('docs').countDocuments({}) }; }
    catch (e) { trace.crossTenantRead = { ok: false, ...err(e) }; }
  } catch (e) { trace.connectError = err(e); }
  finally { await c.close().catch(() => {}); }
  return trace;
}
if (out.createScopedUser?.ok) out.scopedUserAccess = await asUser('tenant_a_user', 'tenantApass1', 'tenant_a');

console.log(JSON.stringify(out, null, 2));
