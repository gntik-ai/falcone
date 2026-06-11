// Realtime executor (changes: add-realtime-changestream, add-realtime-mongo-deletes).
//
// The realtime engine over the executor: subscribe to a workspace collection's changes via
// a MongoDB change stream and push them to the caller. Tenant isolation is enforced IN the
// change-stream pipeline ($match on the verified tenant), so a subscriber only ever sees its
// own tenant's changes. insert/update/replace are tenant-scoped on fullDocument.tenantId;
// DELETE is tenant-scoped on fullDocumentBeforeChange.tenantId, which requires collection
// pre-images (changeStreamPreAndPostImages, MongoDB 6.0+) — enabled best-effort on subscribe.
import { MongoClient } from 'mongodb'

import { clientError } from './errors.mjs'

export function createRealtimeExecutor(options = {}) {
  if (typeof options.resolveUri !== 'function') {
    throw new TypeError('createRealtimeExecutor requires a resolveUri(workspaceId) function')
  }
  const clients = new Map() // uri -> connected MongoClient

  async function clientFor(uri) {
    let client = clients.get(uri)
    if (!client) {
      client = new MongoClient(uri)
      await client.connect()
      clients.set(uri, client)
    }
    return client
  }

  async function resolve(workspaceId) {
    const uri = await options.resolveUri(workspaceId)
    if (!uri) throw clientError(`No MongoDB is provisioned for workspace ${workspaceId}`, 503, 'WORKSPACE_DB_UNRESOLVED')
    return uri
  }

  // Open a tenant-scoped change stream. Calls onChange(event) per change and onError(err)
  // on stream failure. Returns { close } and also closes when params.signal aborts.
  // params: { workspaceId, databaseName, collectionName, identity:{tenantId}, onChange, onError, signal }
  async function subscribe(params) {
    const tenantId = params.identity?.tenantId
    if (!tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING')
    const workspaceId = params.workspaceId ?? params.identity?.workspaceId
    if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING')

    const uri = await resolve(workspaceId)
    const client = await clientFor(uri)
    const db = client.db(params.databaseName)
    const collection = db.collection(params.collectionName)

    // Enable change-stream pre-images (MongoDB 6.0+) so DELETE events carry the deleted
    // document's prior state (fullDocumentBeforeChange) — the only way to tenant-scope a
    // delete (its change event otherwise has just documentKey._id). Best-effort + idempotent:
    // if it can't be enabled (older Mongo, missing collection, permissions) inserts/updates
    // still stream and deletes are simply not delivered (never leaked).
    await db.command({ collMod: params.collectionName, changeStreamPreAndPostImages: { enabled: true } }).catch(() => {})

    // Tenant scope is enforced server-side by the pipeline: only this tenant's documents.
    // insert/update/replace carry fullDocument; delete carries fullDocumentBeforeChange.
    const pipeline = [{
      $match: {
        $or: [
          { operationType: { $in: ['insert', 'update', 'replace'] }, 'fullDocument.tenantId': tenantId },
          { operationType: 'delete', 'fullDocumentBeforeChange.tenantId': tenantId }
        ]
      }
    }]
    const stream = collection.watch(pipeline, { fullDocument: 'updateLookup', fullDocumentBeforeChange: 'whenAvailable' })

    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      params.signal?.removeEventListener?.('abort', onAbort)
      await stream.close().catch(() => {})
    }
    const onAbort = () => { void close() }
    params.signal?.addEventListener?.('abort', onAbort, { once: true })

    stream.on('change', (event) => {
      params.onChange?.({
        type: event.operationType,
        documentId: event.documentKey?._id ?? null,
        // delete carries the prior doc as fullDocumentBeforeChange
        document: event.fullDocument ?? event.fullDocumentBeforeChange ?? null
      })
    })
    stream.on('error', (error) => {
      params.onError?.(error)
      void close()
    })

    return { close }
  }

  async function closeAll() {
    for (const client of clients.values()) await client.close().catch(() => {})
    clients.clear()
  }

  return { subscribe, close: closeAll }
}
