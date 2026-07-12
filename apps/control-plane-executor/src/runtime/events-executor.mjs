// Events (Kafka) executor (change: add-events-execute).
//
// Unlike Postgres/Mongo, the Kafka adapter builds only topic-admin/ACL policy — there is no
// executable produce/consume plan — so this executes directly via `kafkajs`. Tenant isolation
// is STRUCTURAL: every logical topic maps to a per-workspace physical topic `evt.<ws>.<topic>`,
// so a workspace can only ever produce to / consume from / list its own topics (the same
// prefix-isolation model the kind runtime's kafka-handlers use). The logical name is what the
// API exposes; the physical prefix is never crossable.
import { randomUUID } from 'node:crypto'

import { Kafka, logLevel } from 'kafkajs'

import { clientError } from './errors.mjs'
import { resolveKafkaSecurity } from '../../../../packages/internal-contracts/src/transport-security.mjs'

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/

function physicalTopic(workspaceId, topic) {
  if (!NAME.test(workspaceId)) throw clientError('Invalid workspace id', 400, 'INVALID_WORKSPACE')
  if (!NAME.test(topic)) throw clientError('Invalid topic name', 400, 'INVALID_TOPIC')
  return `evt.${workspaceId}.${topic}`
}
const workspacePrefix = (workspaceId) => `evt.${workspaceId}.`
const toLogical = (physical, workspaceId) => physical.slice(workspacePrefix(workspaceId).length)

export function createEventsExecutor(options = {}) {
  const brokers = (options.brokers ?? '').split(',').map((b) => b.trim()).filter(Boolean)
  if (brokers.length === 0) throw new TypeError('createEventsExecutor requires brokers')
  const kafka = new Kafka({ clientId: 'in-falcone-control-plane', brokers, logLevel: logLevel.NOTHING, ...resolveKafkaSecurity() })
  let producerP = null
  let adminP = null

  async function producer() {
    if (!producerP) {
      const p = kafka.producer()
      producerP = p.connect().then(() => p).catch((e) => { producerP = null; throw e })
    }
    return producerP
  }
  async function admin() {
    if (!adminP) {
      const a = kafka.admin()
      adminP = a.connect().then(() => a).catch((e) => { adminP = null; throw e })
    }
    return adminP
  }

  async function consumeOnce(physical, { maxMessages = 10, timeoutMs = 3000 } = {}) {
    const consumer = kafka.consumer({ groupId: `cp-exec-${randomUUID()}` })
    await consumer.connect()
    await consumer.subscribe({ topic: physical, fromBeginning: true })
    const messages = []
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      consumer.run({
        eachMessage: async ({ message }) => {
          messages.push({
            key: message.key ? message.key.toString() : null,
            value: message.value ? message.value.toString() : null,
            offset: message.offset,
            timestamp: message.timestamp
          })
          if (messages.length >= maxMessages) { clearTimeout(timer); resolve() }
        }
      }).catch(() => { clearTimeout(timer); resolve() })
    })
    await consumer.disconnect().catch(() => {})
    return messages.slice(0, maxMessages)
  }

  // params: { operation, workspaceId, topic, identity:{tenantId,workspaceId}, payload }
  async function executeEvents(params) {
    const identity = params.identity ?? {}
    const workspaceId = params.workspaceId ?? identity.workspaceId
    if (!identity.tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING')
    if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING')
    const op = params.operation

    try {
      if (op === 'list_topics') {
        const all = await (await admin()).listTopics()
        const prefix = workspacePrefix(workspaceId)
        return { items: all.filter((t) => t.startsWith(prefix)).map((t) => ({ topic: toLogical(t, workspaceId) })) }
      }
      if (op === 'create_topic') {
        const topic = params.topic ?? params.payload?.name ?? params.payload?.topic
        const physical = physicalTopic(workspaceId, topic)
        const created = await (await admin()).createTopics({
          topics: [{ topic: physical, numPartitions: params.payload?.partitions ?? 1, replicationFactor: 1 }]
        })
        return { topic, created }
      }
      if (op === 'publish') {
        const physical = physicalTopic(workspaceId, params.topic)
        const records = (params.payload?.messages ?? [params.payload ?? {}]).map((m) => ({
          key: m.key != null ? String(m.key) : undefined,
          value: typeof m.value === 'string' ? m.value : JSON.stringify(m.value ?? m)
        }))
        if (records.length === 0) throw clientError('publish requires at least one message', 400, 'EMPTY_PUBLISH')
        const result = await (await producer()).send({ topic: physical, messages: records })
        return { topic: params.topic, published: records.length, partitions: result }
      }
      if (op === 'consume') {
        const physical = physicalTopic(workspaceId, params.topic)
        const messages = await consumeOnce(physical, {
          maxMessages: params.payload?.maxMessages,
          timeoutMs: params.payload?.timeoutMs
        })
        return { topic: params.topic, messages }
      }
      throw clientError(`Unsupported events operation ${op}`, 400, 'UNSUPPORTED_OPERATION')
    } catch (caught) {
      if (caught.statusCode) throw caught
      throw Object.assign(new Error('Kafka operation failed'), { statusCode: 502, code: 'KAFKA_ERROR', cause: caught })
    }
  }

  async function close() {
    if (producerP) await (await producerP).disconnect().catch(() => {})
    if (adminP) await (await adminP).disconnect().catch(() => {})
  }

  return { executeEvents, close }
}
