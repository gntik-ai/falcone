// WalBsonDecoder — change add-ferretdb-realtime-cdc-remediation (#460).
//
// FerretDB v2 (postgres-documentdb engine) has no MongoDB change streams, so realtime SSE and
// the Kafka CDC bridge consume a Postgres logical replication slot (pgoutput) on the
// `documentdb_data` tables instead. This module is the PURE decoder for the row changes that
// `pg-logical-replication` (pgoutput plugin, default TEXT mode) delivers — no I/O, unit-testable.
//
// Verified against ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0 (2026-06-15):
//   - Each Mongo collection is a table `documentdb_data.documents_<collection_id>` with columns
//     `shard_key_value int8`, `object_id bson`, `document bson`. The `document` column holds the
//     FULL document, including the `tenantId` field (tenantId is NOT a column).
//   - The `bson` type's output function renders a column value as the literal string
//     `BSONHEX<hex>`, where <hex> is the raw little-endian BSON document bytes (first 4 bytes are
//     the document length). pgoutput TEXT mode (and test_decoding) deliver exactly that string.
//     => decode = bson.deserialize(Buffer.from(value.slice('BSONHEX'.length), 'hex')).
//   - With REPLICA IDENTITY FULL: INSERT carries `log.new` only; UPDATE carries both `log.old`
//     (pre-image) and `log.new`; DELETE carries `log.old` only (the full deleted document).

import { deserialize } from 'bson'

export const BSONHEX_PREFIX = 'BSONHEX'

// Decode a `documentdb_core.bson` column value as rendered by pgoutput.
// Returns a plain JS object, or null when the column is null/absent.
export function decodeBsonColumn(value) {
  if (value == null) return null
  // Defensive: a future binary-mode path would deliver the raw bson_send bytes as a Buffer.
  if (Buffer.isBuffer(value)) return deserialize(value)
  if (typeof value !== 'string') {
    throw new TypeError(`Unexpected bson column value type: ${typeof value}`)
  }
  if (!value.startsWith(BSONHEX_PREFIX)) {
    throw new Error(`bson column value missing ${BSONHEX_PREFIX} prefix: ${value.slice(0, 24)}…`)
  }
  return deserialize(Buffer.from(value.slice(BSONHEX_PREFIX.length), 'hex'))
}

// `documentdb_data.documents_<collection_id>` → collection_id (number), or null when the
// relation is not a per-collection documents table (retry_<id>, collection_pk_<id>, …).
const DOCUMENTS_TABLE = /^documents_(\d+)$/
export function parseDocumentsCollectionId(relationName) {
  const match = DOCUMENTS_TABLE.exec(relationName ?? '')
  return match ? Number(match[1]) : null
}

// Map a pgoutput DML message into a normalized WAL change, or null when the message is not an
// insert/update/delete on a `documentdb_data.documents_<id>` table.
//
// `log` is a pg-logical-replication pgoutput message: { tag, relation:{schema,name}, new, old }.
// `new`/`old` are decoded tuples keyed by column name; the `document`/`object_id` columns arrive
// as `BSONHEX<hex>` strings.
//
// Output: { walOp, collectionId, documentId, tenantId, workspaceId, fullDocument, fullDocumentBeforeChange }
//   walOp is the raw WAL operation ('insert'|'update'|'delete'); each consumer maps it to its own
//   surface operationType (e.g. realtime/CDC treat a WAL UPDATE as a full-document 'replace',
//   since logical replication cannot distinguish $set updates from replacements).
//   tenantId/workspaceId are read off the document image (the data-API adapter stamps BOTH on every
//   write — services/adapters/src/mongodb-data-api.mjs::injectTenantIntoDocument); workspaceId lets
//   the realtime consumer scope per workspace so two workspaces of one tenant sharing a
//   db+collection name do not cross-receive changes (#688).
export function decodeWalMessage(log) {
  if (!log || (log.tag !== 'insert' && log.tag !== 'update' && log.tag !== 'delete')) return null
  const relation = log.relation
  if (relation?.schema !== 'documentdb_data') return null
  const collectionId = parseDocumentsCollectionId(relation.name)
  if (collectionId == null) return null // retry_<id> etc. are in the publication but not documents

  const fullDocument = decodeBsonColumn(log.new?.document)
  const fullDocumentBeforeChange = decodeBsonColumn(log.old?.document)
  const image = fullDocument ?? fullDocumentBeforeChange
  return {
    walOp: log.tag,
    collectionId,
    documentId: image?._id ?? null,
    tenantId: image?.tenantId ?? null,
    workspaceId: image?.workspaceId ?? null,
    fullDocument,
    fullDocumentBeforeChange
  }
}
