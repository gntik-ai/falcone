import test from 'node:test'
import assert from 'node:assert/strict'

import { ensurePublicationAndReplicaIdentity } from '../../src/provisionLogicalReplication.mjs'

// Fake pg pool: records every query and answers the two reads `ensurePublicationAndReplicaIdentity`
// issues (publication lookup, documents_* table list). `alter` lets a test choose whether an
// `ALTER TABLE … REPLICA IDENTITY FULL` resolves or rejects (and with which error code).
function makePool({ publicationExists = true, tables = [], alter = async () => ({ rows: [] }) } = {}) {
  const queries = []
  const query = async (sql, params) => {
    queries.push({ sql, params })
    if (/FROM pg_publication/.test(sql)) {
      return { rows: publicationExists ? [{ '?column?': 1 }] : [] }
    }
    if (/documentdb_data/.test(sql) && /pg_class/.test(sql)) {
      return { rows: tables }
    }
    if (/ALTER TABLE/.test(sql)) {
      return alter(sql)
    }
    return { rows: [] }
  }
  return { query, queries }
}

const alters = (pool) => pool.queries.filter((q) => /ALTER TABLE/.test(q.sql)).map((q) => q.sql)

// #688 — startup must not require the replication role to OWN the engine tables.

test('skips ALTER when every documents_* table is already REPLICA IDENTITY FULL (relreplident=f)', async () => {
  const pool = makePool({
    publicationExists: true,
    tables: [
      { relname: 'documents_1', relreplident: 'f' },
      { relname: 'documents_27', relreplident: 'f' }
    ],
    alter: async () => {
      throw Object.assign(new Error('must be owner of table documents_1'), { code: '42501' })
    }
  })

  await ensurePublicationAndReplicaIdentity(pool, 'falcone_cdc_pub')

  assert.deepEqual(alters(pool), [], 'no ALTER TABLE … REPLICA IDENTITY FULL is issued for already-FULL tables')
})

test('does NOT create the publication when it already exists', async () => {
  const pool = makePool({ publicationExists: true, tables: [] })
  await ensurePublicationAndReplicaIdentity(pool, 'falcone_cdc_pub')
  assert.ok(!pool.queries.some((q) => /CREATE PUBLICATION/.test(q.sql)), 'existing publication is not recreated')
})

test('creates the publication when it is missing', async () => {
  const pool = makePool({ publicationExists: false, tables: [] })
  await ensurePublicationAndReplicaIdentity(pool, 'falcone_cdc_pub')
  assert.ok(
    pool.queries.some((q) => /CREATE PUBLICATION falcone_cdc_pub FOR TABLES IN SCHEMA documentdb_data/.test(q.sql)),
    'missing publication is created'
  )
})

test('tolerates 42501 (insufficient_privilege) on the ALTER for a not-yet-FULL table — does not throw', async () => {
  const pool = makePool({
    publicationExists: true,
    // 'd' = default replica identity (NOT full) → the function attempts the ALTER.
    tables: [{ relname: 'documents_5', relreplident: 'd' }],
    alter: async () => {
      throw Object.assign(new Error('must be owner of table documents_5'), { code: '42501' })
    }
  })

  await assert.doesNotReject(
    () => ensurePublicationAndReplicaIdentity(pool, 'falcone_cdc_pub'),
    'a non-owner ALTER raising 42501 must NOT abort the WAL consumer'
  )
  assert.deepEqual(alters(pool), ['ALTER TABLE documentdb_data.documents_5 REPLICA IDENTITY FULL'], 'the ALTER was attempted once')
})

test('an owner-privileged role applies the ALTER to a not-yet-FULL table', async () => {
  const pool = makePool({
    publicationExists: true,
    tables: [{ relname: 'documents_9', relreplident: 'd' }],
    alter: async () => ({ rows: [] }) // owner: succeeds
  })

  await ensurePublicationAndReplicaIdentity(pool, 'falcone_cdc_pub')
  assert.deepEqual(alters(pool), ['ALTER TABLE documentdb_data.documents_9 REPLICA IDENTITY FULL'])
})

test('re-throws an ALTER error that is NOT 42501', async () => {
  const pool = makePool({
    publicationExists: true,
    tables: [{ relname: 'documents_3', relreplident: 'd' }],
    alter: async () => {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' })
    }
  })

  await assert.rejects(
    () => ensurePublicationAndReplicaIdentity(pool, 'falcone_cdc_pub'),
    (err) => err.code === '40P01',
    'a non-privilege ALTER error must propagate'
  )
})

test('rejects an unsafe publication name (SQL-identifier guard intact)', async () => {
  const pool = makePool()
  await assert.rejects(() => ensurePublicationAndReplicaIdentity(pool, 'bad name; DROP'), /Unsafe publication name/)
})
