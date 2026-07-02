// Real-stack test for spec change fix-ferretdb-gateway-authentication (finding F2).
//
// Exercises the live FerretDB gateway over the DocumentDB engine in tests/env (docker-compose):
// FerretDB v2 delegates authentication to its DocumentDB Postgres backend, so a Mongo client must
// present credentials that map to a real Postgres login role (the DocumentDB admin — the same role
// the FerretDB postgresql-url uses). The campaign deploy hardcoded MONGO_USER=falcone, which did
// not match the admin role (falcone_doc_admin), so the handshake failed and all /v1/mongo/* 500'd.
//
// This test proves the auth contract the fix relies on:
//   - the admin identity (MONGO_URI) authenticates AND a full insert+list document round-trip works
//   - a non-existent identity is rejected ("Authentication failed")
//
// Self-skips when the tests/env FerretDB is not reachable (e.g. the plain black-box suite, which
// does not start docker-compose), mirroring the pgvector real-stack self-skip precedent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';

const ADMIN_URI = process.env.MONGO_TEST_URI || process.env.MONGO_URI || 'mongodb://falcone:falcone@localhost:57017/';
const DB_NAME = 'f2_authcheck';
const COLL = 'items';

// Build a URI with a deliberately non-existent identity (no such Postgres login role).
function withUser(uri, user, pass) {
  return uri.replace(/^mongodb:\/\/[^@/]*@/, `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
}

let reachable = false;
before(async () => {
  const c = new MongoClient(ADMIN_URI, { serverSelectionTimeoutMS: 2500 });
  try {
    await c.connect();
    await c.db(DB_NAME).command({ ping: 1 });
    reachable = true;
  } catch {
    reachable = false;
  } finally {
    await c.close().catch(() => {});
  }
});

after(async () => {
  if (!reachable) return;
  const c = new MongoClient(ADMIN_URI, { serverSelectionTimeoutMS: 2500 });
  try { await c.connect(); await c.db(DB_NAME).dropDatabase(); } catch {} finally { await c.close().catch(() => {}); }
});

test('env-f2-01: admin identity authenticates and an insert+list round-trip succeeds', async (t) => {
  if (!reachable) return t.skip('FerretDB (tests/env) not reachable');
  const c = new MongoClient(ADMIN_URI, { serverSelectionTimeoutMS: 4000 });
  try {
    await c.connect();
    const coll = c.db(DB_NAME).collection(COLL);
    await coll.deleteMany({});
    await coll.insertOne({ tenantId: 't_acme', name: 'widget', qty: 7 });
    const docs = await coll.find({ tenantId: 't_acme' }).toArray();
    assert.equal(docs.length, 1, 'inserted document must be listed back');
    assert.equal(docs[0].qty, 7);
  } finally {
    await c.close().catch(() => {});
  }
});

test('env-f2-02: a non-existent identity is rejected by the gateway', async (t) => {
  if (!reachable) return t.skip('FerretDB (tests/env) not reachable');
  const c = new MongoClient(withUser(ADMIN_URI, 'f2_nosuchrole', 'wrong-pw'), { serverSelectionTimeoutMS: 4000 });
  await assert.rejects(
    (async () => { await c.connect(); await c.db(DB_NAME).command({ ping: 1 }); })(),
    (e) => /Authentication failed|auth|SCRAM|role .* does not exist/i.test(String(e.message)),
    'a Mongo identity with no backing Postgres role must fail authentication',
  );
  await c.close().catch(() => {});
});
