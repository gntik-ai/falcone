import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({})
}))

import { requestConsoleSessionJson } from '@/lib/console-session'
import { consumeMessages, createTopic, listTopics, publishMessage } from './eventsApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]
const topics = '/v1/events/workspaces/ws1/topics'

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue({})
})

describe('eventsApi — executor event routes (workspace-scoped)', () => {
  it('listTopics → GET topics', async () => {
    await listTopics('ws1')
    expect(lastCall()).toEqual([topics])
  })

  it('createTopic → POST topics { name, partitions }', async () => {
    await createTopic('ws1', 'orders', { partitions: 3 })
    expect(lastCall()).toEqual([topics, { method: 'POST', body: { name: 'orders', partitions: 3 } }])
  })

  it('publishMessage → POST topics/{topic}/publish with the message body', async () => {
    await publishMessage('ws1', 'orders', { key: 'k1', value: { amount: 10 } })
    expect(lastCall()).toEqual([`${topics}/orders/publish`, { method: 'POST', body: { key: 'k1', value: { amount: 10 } } }])
  })

  it('consumeMessages → GET topics/{topic}/messages with maxMessages + timeoutMs', async () => {
    await consumeMessages('ws1', 'orders', { maxMessages: 5, timeoutMs: 2000 })
    expect(lastCall()[0]).toBe(`${topics}/orders/messages?maxMessages=5&timeoutMs=2000`)
  })

  it('consumeMessages without options omits the query string', async () => {
    await consumeMessages('ws1', 'orders')
    expect(lastCall()).toEqual([`${topics}/orders/messages`])
  })
})
