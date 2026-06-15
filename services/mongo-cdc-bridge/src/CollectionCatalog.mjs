// CollectionCatalog — change add-ferretdb-realtime-cdc-remediation (#460).
//
// Resolves a documentdb `collection_id` (parsed from a `documents_<id>` WAL relation) into its
// MongoDB { databaseName, collectionName } via the engine's catalog table
// `documentdb_api_catalog.collections (database_name, collection_name, collection_id)`.
//
// The pgoutput relation message only carries the Postgres table name (documents_<id>), not the
// Mongo namespace, so this lookup is required to map a WAL change back to its collection. The
// mapping is stable per collection, so it is cached; a cache miss (a collection created after the
// cache warmed) triggers a single refresh query.
export class CollectionCatalog {
  constructor(pool) {
    if (!pool || typeof pool.query !== 'function') throw new TypeError('CollectionCatalog requires a pg pool')
    this.pool = pool
    this.cache = new Map()
  }

  async resolve(collectionId) {
    if (collectionId == null) return null
    if (this.cache.has(collectionId)) return this.cache.get(collectionId)
    const entry = await this._load(collectionId)
    if (entry) this.cache.set(collectionId, entry)
    return entry
  }

  async _load(collectionId) {
    const { rows } = await this.pool.query(
      'SELECT database_name, collection_name FROM documentdb_api_catalog.collections WHERE collection_id = $1 LIMIT 1',
      [collectionId]
    )
    if (!rows[0]) return null
    return { databaseName: rows[0].database_name, collectionName: rows[0].collection_name }
  }

  invalidate(collectionId) {
    if (collectionId == null) this.cache.clear()
    else this.cache.delete(collectionId)
  }
}
