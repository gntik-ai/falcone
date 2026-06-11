// MongoDB data-API executor (change: add-mongo-data-execute).
//
// Mirrors the Postgres executor: it asks the (spec-only) adapter to BUILD the Mongo
// command plan (services/adapters/src/mongodb-data-api.mjs::buildMongoDataApiPlan) and
// then EXECUTES it via the real `mongodb` driver. Tenant isolation is enforced by the
// adapter, which injects the tenant predicate into every query filter and stamps the
// tenant onto inserted documents — so a forgotten filter cannot cross tenants and a
// write cannot forge another tenant. (Mongo has no RLS/SET ROLE; the filter IS the guard.)
import { MongoClient } from 'mongodb'

import { buildMongoDataApiPlan } from '../../../../services/adapters/src/mongodb-data-api.mjs'
import { clientError } from './errors.mjs'

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

  async function resolve(workspaceId) {
    const uri = await options.resolveUri(workspaceId)
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
        effectiveRoleName: identity.roleName
      })
    } catch (caught) {
      // adapter validation error (MongoDataApiError has .status/.code)
      throw clientError(caught.message, caught.status ?? 400, caught.code ?? 'PLAN_REJECTED')
    }

    const uri = await resolve(workspaceId)
    const collection = (await clientFor(uri)).db(params.databaseName).collection(params.collectionName)
    const op = plan.operation

    try {
      if (op === 'list') {
        const query = plan.query ?? {}
        const items = await collection
          .find(query.filter ?? {}, { projection: query.projection })
          .sort(query.sort ?? { _id: 1 })
          .limit(query.limit ?? 25)
          .toArray()
        return { items, page: { size: query.limit, returned: items.length } }
      }
      if (op === 'get') {
        const doc = await collection.findOne(plan.query.filter, { projection: plan.query.projection })
        return { found: doc != null, item: doc ?? null }
      }
      if (op === 'insert') {
        const result = await collection.insertOne(plan.write.document)
        return { item: { ...plan.write.document, _id: plan.write.document._id ?? result.insertedId }, insertedId: result.insertedId }
      }
      if (op === 'update') {
        const result = await collection.updateOne(plan.query.filter, plan.write.update, { upsert: plan.write.upsert === true })
        return { matched: result.matchedCount, modified: result.modifiedCount, upsertedId: result.upsertedId ?? null }
      }
      if (op === 'replace') {
        const result = await collection.replaceOne(plan.query.filter, plan.write.replacement, { upsert: plan.write.upsert === true })
        return { matched: result.matchedCount, modified: result.modifiedCount, upsertedId: result.upsertedId ?? null }
      }
      if (op === 'delete') {
        const result = await collection.deleteOne(plan.query.filter)
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
