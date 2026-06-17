// MongoDB data-API executor (change: add-mongo-data-execute).
//
// Mirrors the Postgres executor: it asks the (spec-only) adapter to BUILD the Mongo
// command plan (services/adapters/src/mongodb-data-api.mjs::buildMongoDataApiPlan) and
// then EXECUTES it via the real `mongodb` driver. Tenant isolation is enforced by the
// adapter, which injects the tenant predicate into every query filter and stamps the
// tenant onto inserted documents — so a forgotten filter cannot cross tenants and a
// write cannot forge another tenant. (Mongo has no RLS/SET ROLE; the filter IS the guard.)
import { MongoClient, ObjectId } from 'mongodb'

import { buildMongoDataApiPlan, encodeMongoDataCursor } from '../../../../services/adapters/src/mongodb-data-api.mjs'
import { clientError } from './errors.mjs'

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/

// A document inserted without an explicit `_id` is stored with a BSON ObjectId (the driver
// generates it client-side), but the by-id handlers carry the id through as the plain hex
// STRING the client echoes back — so `{_id: "<hex>"}` never matches the stored ObjectId and
// get/update/replace/delete by id silently no-op (fix-mongo-document-id-objectid-coercion, #495).
// When the by-id value is a 24-char hex string, match EITHER the ObjectId or the raw string so
// that auto-generated ObjectId ids resolve while custom string ids (incl. hex-looking ones) keep
// matching. Non-ObjectId ids are left untouched (string fallback, per spec).
//
// The adapter merges the tenant predicate via `mergeFilters`, which yields `{$and:[{tenantId},
// {_id}]}` — so the `_id` clause is NESTED inside `$and`, not at the top level. We therefore
// descend through the logical operators (`$and`/`$or`/`$nor`) and rewrite each `_id` equality
// branch, never touching the tenant clause: the `$or` only widens the `_id` match, the tenant
// scope is ANDed in exactly as before. Exported for deterministic unit coverage.
export function coerceDocumentIdFilter(node) {
  if (Array.isArray(node)) return node.map(coerceDocumentIdFilter)
  if (!node || typeof node !== 'object') return node
  const rewritten = {}
  let idOr
  for (const [key, value] of Object.entries(node)) {
    if (key === '_id' && typeof value === 'string' && OBJECT_ID_HEX.test(value)) {
      idOr = { $or: [{ _id: new ObjectId(value) }, { _id: value }] }
      continue
    }
    rewritten[key] = (key === '$and' || key === '$or' || key === '$nor') && Array.isArray(value)
      ? value.map(coerceDocumentIdFilter)
      : value
  }
  if (!idOr) return rewritten
  if (Object.keys(rewritten).length === 0) return idOr
  // Sibling clauses (e.g. an explicit `$or` from a caller) stay ANDed with the id match.
  return '$or' in rewritten ? { $and: [rewritten, idOr] } : { ...rewritten, ...idOr }
}

export function createMongoExecutor(options = {}) {
  if (typeof options.resolveUri !== 'function') {
    throw new TypeError('createMongoExecutor requires a resolveUri(workspaceId) function')
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

  // resolveUri receives the workspaceId AND the request identity ({ tenantId, workspaceId,
  // roleName }) so a per-tenant DocumentDB credential can be resolved (FerretDB migration
  // #458). Existing single-URI resolvers ignore the second arg, so this is backward
  // compatible. Tenant isolation is STILL enforced by the adapter's tenantId scoping —
  // the per-tenant credential is least-privilege auth/audit, NOT the isolation boundary.
  async function resolve(workspaceId, identity) {
    const uri = await options.resolveUri(workspaceId, identity)
    if (!uri) {
      throw clientError(`No MongoDB is provisioned for workspace ${workspaceId}`, 503, 'WORKSPACE_DB_UNRESOLVED')
    }
    return uri
  }

  // params: { operation, workspaceId, databaseName, collectionName, documentId,
  //           filter, projection, sort, page, payload, identity:{tenantId,workspaceId,roleName} }
  async function executeMongoData(params) {
    const identity = params.identity ?? {}
    const tenantId = identity.tenantId
    const workspaceId = params.workspaceId ?? identity.workspaceId
    if (!tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING')
    if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING')

    let plan
    try {
      plan = buildMongoDataApiPlan({
        operation: params.operation ?? 'list',
        workspaceId,
        databaseName: params.databaseName,
        collectionName: params.collectionName,
        documentId: params.documentId,
        tenantId,
        filter: params.filter,
        projection: params.projection,
        sort: params.sort,
        page: params.page ?? {},
        payload: params.payload ?? {},
        effectiveRoleName: identity.roleName,
        // Backend capability profile (FerretDB cutover, #459). When the backend is FerretDB
        // this carries supportsTransactions=false, so the plan builder rejects a transaction
        // op at the API boundary (501 TRANSACTION_NOT_SUPPORTED) before any op is dispatched.
        // Defaults to {} (MongoDB 7 / unknown) — only transaction/change_stream ops consult it.
        topology: options.topology ?? {}
      })
    } catch (caught) {
      // adapter validation error (MongoDataApiError has .status/.code)
      throw clientError(caught.message, caught.status ?? 400, caught.code ?? 'PLAN_REJECTED')
    }

    const uri = await resolve(workspaceId, identity)
    const collection = (await clientFor(uri)).db(params.databaseName).collection(params.collectionName)
    const op = plan.operation

    try {
      if (op === 'list') {
        const query = plan.query ?? {}
        const sort = query.sort ?? { _id: 1 }
        const limit = query.limit ?? 25
        const items = await collection
          .find(query.filter ?? {}, { projection: query.projection })
          .sort(sort)
          .limit(limit)
          .toArray()
        // Keyset cursor: when a full page came back, emit a next cursor from the last
        // document's sort-field values (the adapter decodes `values` to resume).
        let after
        if (items.length > 0 && items.length >= limit) {
          const lastDoc = items[items.length - 1]
          const fields = Object.keys(sort)
          if (fields.every((field) => lastDoc[field] !== undefined)) {
            after = encodeMongoDataCursor({ values: Object.fromEntries(fields.map((field) => [field, lastDoc[field]])) })
          }
        }
        return { items, page: { size: limit, returned: items.length, after } }
      }
      if (op === 'get') {
        const doc = await collection.findOne(coerceDocumentIdFilter(plan.query.filter), { projection: plan.query.projection })
        return { found: doc != null, item: doc ?? null }
      }
      if (op === 'insert') {
        const result = await collection.insertOne(plan.write.document)
        return { item: { ...plan.write.document, _id: plan.write.document._id ?? result.insertedId }, insertedId: result.insertedId }
      }
      if (op === 'update') {
        const result = await collection.updateOne(coerceDocumentIdFilter(plan.query.filter), plan.write.update, { upsert: plan.write.upsert === true })
        return { matched: result.matchedCount, modified: result.modifiedCount, upsertedId: result.upsertedId ?? null }
      }
      if (op === 'replace') {
        const result = await collection.replaceOne(coerceDocumentIdFilter(plan.query.filter), plan.write.replacement, { upsert: plan.write.upsert === true })
        return { matched: result.matchedCount, modified: result.modifiedCount, upsertedId: result.upsertedId ?? null }
      }
      if (op === 'delete') {
        const result = await collection.deleteOne(coerceDocumentIdFilter(plan.query.filter))
        return { deleted: result.deletedCount }
      }
      throw clientError(`Operation ${op} is not yet executed by the Mongo executor`, 400, 'UNSUPPORTED_OPERATION')
    } catch (caught) {
      if (caught.statusCode) throw caught
      // opaque 500 — never leak driver internals; caller logs server-side
      throw Object.assign(new Error('MongoDB operation failed'), { statusCode: 500, code: 'MONGO_ERROR', cause: caught })
    }
  }

  async function close() {
    await Promise.all([...clients.values()].map((client) => client.close().catch(() => {})))
    clients.clear()
  }

  return { executeMongoData, close }
}
