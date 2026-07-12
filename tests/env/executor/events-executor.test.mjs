// Real-Kafka proof for change add-events-execute (tests/env Redpanda).
// Proves the events executor produces/consumes via kafkajs with STRUCTURAL per-workspace
// isolation: each logical topic maps to evt.<ws>.<topic>, so one workspace cannot read or
// write another's stream. Run via tests/env/executor/run-events.sh.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Kafka, logLevel } from 'kafkajs'
import { createEventsExecutor } from '../../../apps/control-plane-executor/src/runtime/events-executor.mjs'

const BROKERS = process.env.KAFKA_BROKERS ?? 'localhost:19092'
const WS_A = 'wsevta'
const WS_B = 'wsevtb'
const TOPIC = 'orders'

let exec
let raw // raw admin client for cleanup

const idA = { tenantId: 'ten_evt_a', workspaceId: WS_A }
const idB = { tenantId: 'ten_evt_b', workspaceId: WS_B }

before(async () => {
  exec = createEventsExecutor({ brokers: BROKERS })
  raw = new Kafka({ clientId: 'evt-test-cleanup', brokers: BROKERS.split(','), logLevel: logLevel.NOTHING })
})

after(async () => {
  await exec?.close().catch(() => {})
  // best-effort: drop the test topics
  const a = raw.admin()
  await a.connect().catch(() => {})
  await a.deleteTopics({ topics: [`evt.${WS_A}.${TOPIC}`, `evt.${WS_B}.${TOPIC}`] }).catch(() => {})
  await a.disconnect().catch(() => {})
})

test('create topic provisions a per-workspace physical topic', async () => {
  const res = await exec.executeEvents({ identity: idA, workspaceId: WS_A, operation: 'create_topic', topic: TOPIC })
  assert.equal(res.topic, TOPIC)
  await exec.executeEvents({ identity: idB, workspaceId: WS_B, operation: 'create_topic', topic: TOPIC }).catch(() => {})
})

test('publish + consume round-trips messages within the workspace', async () => {
  const pub = await exec.executeEvents({
    identity: idA, workspaceId: WS_A, operation: 'publish', topic: TOPIC,
    payload: { messages: [{ key: 'o1', value: { id: 1 } }, { key: 'o2', value: { id: 2 } }, { key: 'o3', value: { id: 3 } }] }
  })
  assert.equal(pub.published, 3)

  const consumed = await exec.executeEvents({
    identity: idA, workspaceId: WS_A, operation: 'consume', topic: TOPIC, payload: { maxMessages: 10, timeoutMs: 4000 }
  })
  assert.equal(consumed.messages.length, 3)
  assert.deepEqual(consumed.messages.map((m) => m.key).sort(), ['o1', 'o2', 'o3'])
})

test('another workspace cannot read the first workspace stream (prefix isolation)', async () => {
  const consumedB = await exec.executeEvents({
    identity: idB, workspaceId: WS_B, operation: 'consume', topic: TOPIC, payload: { maxMessages: 10, timeoutMs: 3000 }
  })
  assert.equal(consumedB.messages.length, 0, 'workspace B sees nothing on its own (empty) orders topic')
})

test('list_topics is scoped to the workspace', async () => {
  const a = await exec.executeEvents({ identity: idA, workspaceId: WS_A, operation: 'list_topics' })
  assert.ok(a.items.some((t) => t.topic === TOPIC), 'workspace A sees its orders topic')
  // the listed names are logical (no evt.<ws>. prefix leaked)
  assert.ok(a.items.every((t) => !t.topic.startsWith('evt.')))
})

test('missing tenant identity → 401', async () => {
  await assert.rejects(
    () => exec.executeEvents({ workspaceId: WS_A, identity: {}, operation: 'list_topics' }),
    (e) => e.statusCode === 401
  )
})
