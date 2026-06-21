import test from 'node:test'
import assert from 'node:assert/strict'
import { serialize } from 'bson'

import {
  BSONHEX_PREFIX,
  decodeBsonColumn,
  parseDocumentsCollectionId,
  decodeWalMessage
} from '../../src/WalBsonDecoder.mjs'

// Mirror how the DocumentDB `bson` output function renders a column in pgoutput TEXT mode:
// the literal prefix `BSONHEX` followed by the hex of the raw little-endian BSON bytes.
const bsonhex = (doc) => BSONHEX_PREFIX + Buffer.from(serialize(doc)).toString('hex')

const relation = (name) => ({ schema: 'documentdb_data', name })

test('decodeBsonColumn parses BSONHEX strings and round-trips field types', () => {
  const doc = { _id: 'doc-1', tenantId: 'ten_a', n: 42, score: 3.5, tags: ['x', 'y'], nested: { a: 1 } }
  assert.deepEqual(decodeBsonColumn(bsonhex(doc)), doc)
})

test('decodeBsonColumn returns null for null/undefined columns', () => {
  assert.equal(decodeBsonColumn(null), null)
  assert.equal(decodeBsonColumn(undefined), null)
})

test('decodeBsonColumn also accepts raw BSON Buffers (defensive binary path)', () => {
  const doc = { _id: 'b', tenantId: 't' }
  assert.deepEqual(decodeBsonColumn(Buffer.from(serialize(doc))), doc)
})

test('decodeBsonColumn rejects a non-BSONHEX string', () => {
  assert.throws(() => decodeBsonColumn('not-bson'), /missing BSONHEX prefix/)
})

test('parseDocumentsCollectionId extracts the collection id from documents_<id>', () => {
  assert.equal(parseDocumentsCollectionId('documents_2'), 2)
  assert.equal(parseDocumentsCollectionId('documents_137'), 137)
})

test('parseDocumentsCollectionId returns null for non-documents relations', () => {
  assert.equal(parseDocumentsCollectionId('retry_2'), null)
  assert.equal(parseDocumentsCollectionId('collection_pk_2'), null)
  assert.equal(parseDocumentsCollectionId('documents_'), null)
  assert.equal(parseDocumentsCollectionId(undefined), null)
})

test('decodeWalMessage maps an INSERT to the new image with tenantId/documentId', () => {
  const doc = { _id: 'doc-1', tenantId: 'ten_a', body: 'alpha' }
  const out = decodeWalMessage({ tag: 'insert', relation: relation('documents_2'), new: { document: bsonhex(doc) } })
  assert.equal(out.walOp, 'insert')
  assert.equal(out.collectionId, 2)
  assert.equal(out.documentId, 'doc-1')
  assert.equal(out.tenantId, 'ten_a')
  assert.deepEqual(out.fullDocument, doc)
  assert.equal(out.fullDocumentBeforeChange, null)
})

test('decodeWalMessage maps an UPDATE to both pre- and post-images (REPLICA IDENTITY FULL)', () => {
  const before = { _id: 'doc-1', tenantId: 'ten_a', body: 'alpha' }
  const after = { _id: 'doc-1', tenantId: 'ten_a', body: 'alpha-edited' }
  const out = decodeWalMessage({
    tag: 'update',
    relation: relation('documents_2'),
    old: { document: bsonhex(before) },
    new: { document: bsonhex(after) }
  })
  assert.equal(out.walOp, 'update')
  assert.deepEqual(out.fullDocument, after)
  assert.deepEqual(out.fullDocumentBeforeChange, before)
})

test('decodeWalMessage maps a DELETE to the pre-image only (tenant-scopable)', () => {
  const before = { _id: 'doc-1', tenantId: 'ten_a', body: 'alpha-edited' }
  const out = decodeWalMessage({ tag: 'delete', relation: relation('documents_2'), old: { document: bsonhex(before) } })
  assert.equal(out.walOp, 'delete')
  assert.equal(out.fullDocument, null)
  assert.equal(out.documentId, 'doc-1')
  assert.equal(out.tenantId, 'ten_a', 'tenantId is read from the delete pre-image')
  assert.deepEqual(out.fullDocumentBeforeChange, before)
})

test('decodeWalMessage extracts workspaceId from the document image (#688)', () => {
  const doc = { _id: 'doc-1', tenantId: 'ten_a', workspaceId: 'ws_a', body: 'alpha' }
  const out = decodeWalMessage({ tag: 'insert', relation: relation('documents_2'), new: { document: bsonhex(doc) } })
  assert.equal(out.workspaceId, 'ws_a', 'workspaceId is read off the image like tenantId')
  assert.equal(out.tenantId, 'ten_a')
})

test('decodeWalMessage reads workspaceId from the DELETE pre-image (#688)', () => {
  const before = { _id: 'doc-1', tenantId: 'ten_a', workspaceId: 'ws_a' }
  const out = decodeWalMessage({ tag: 'delete', relation: relation('documents_2'), old: { document: bsonhex(before) } })
  assert.equal(out.workspaceId, 'ws_a', 'delete carries workspaceId from the pre-image (tenant+workspace-scopable)')
})

test('decodeWalMessage yields workspaceId=null when the document has no workspaceId (#688)', () => {
  const doc = { _id: 'doc-1', tenantId: 'ten_a' } // legacy / unscoped write
  const out = decodeWalMessage({ tag: 'insert', relation: relation('documents_2'), new: { document: bsonhex(doc) } })
  assert.equal(out.workspaceId, null, 'absence of workspaceId yields null, not undefined')
})

test('decodeWalMessage ignores non-documents relations and non-DML tags', () => {
  assert.equal(decodeWalMessage({ tag: 'insert', relation: relation('retry_2'), new: { document: bsonhex({ _id: 'x' }) } }), null)
  assert.equal(decodeWalMessage({ tag: 'begin' }), null)
  assert.equal(decodeWalMessage({ tag: 'insert', relation: { schema: 'cron', name: 'job_run_details' }, new: {} }), null)
  assert.equal(decodeWalMessage(null), null)
})
