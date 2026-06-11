// Events (Kafka) console (change: add-console-events-data-editor).
// Lists/creates topics, publishes a message, and polls (consumes) recent messages via the
// control-plane executor (@/services/eventsApi).
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@/lib/http'
import type { JsonValue } from '@/lib/http'
import {
  consumeMessages,
  createTopic,
  listTopics,
  publishMessage,
  type EventMessage,
  type TopicRecord
} from '@/services/eventsApi'

export interface EventsConsoleProps {
  workspaceId: string
}

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'Request failed'
}

export function EventsConsole({ workspaceId }: EventsConsoleProps) {
  const [topics, setTopics] = useState<TopicRecord[]>([])
  const [newTopic, setNewTopic] = useState('')
  const [selected, setSelected] = useState('')
  const [messageJson, setMessageJson] = useState('{"value":{}}')
  const [messages, setMessages] = useState<EventMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadTopics = useCallback(async () => {
    try {
      const result = await listTopics(workspaceId)
      setTopics(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [workspaceId])

  useEffect(() => {
    void reloadTopics()
  }, [reloadTopics])

  async function handleCreateTopic() {
    if (newTopic.trim() === '') return
    setBusy(true)
    try {
      await createTopic(workspaceId, newTopic.trim())
      setNewTopic('')
      await reloadTopics()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handlePublish() {
    if (selected === '') {
      setError('Select a topic to publish to')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const parsed = JSON.parse(messageJson) as { key?: string; value: JsonValue }
      await publishMessage(workspaceId, selected, parsed)
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'Message is not valid JSON' : errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleConsume() {
    if (selected === '') {
      setError('Select a topic to consume from')
      return
    }
    setBusy(true)
    try {
      const result = await consumeMessages(workspaceId, selected, { maxMessages: 10, timeoutMs: 3000 })
      setMessages(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Events console">
      {error ? <p role="alert">{error}</p> : null}

      <h3>Topics</h3>
      <ul>
        {topics.map((topic) => (
          <li key={topic.topic}>
            <label>
              <input
                type="radio"
                name="topic"
                value={topic.topic}
                checked={selected === topic.topic}
                onChange={() => setSelected(topic.topic)}
              />
              {topic.topic}
            </label>
          </li>
        ))}
      </ul>
      <label htmlFor="new-topic">New topic</label>
      <input id="new-topic" value={newTopic} onChange={(event) => setNewTopic(event.target.value)} />
      <button type="button" onClick={() => void handleCreateTopic()} disabled={busy}>
        Create topic
      </button>

      <h3>Publish</h3>
      <label htmlFor="message-json">Message (JSON, e.g. {'{ "value": { ... } }'})</label>
      <textarea id="message-json" value={messageJson} onChange={(event) => setMessageJson(event.target.value)} />
      <button type="button" onClick={() => void handlePublish()} disabled={busy}>
        Publish
      </button>

      <h3>Consume</h3>
      <button type="button" onClick={() => void handleConsume()} disabled={busy}>
        Poll messages
      </button>
      <ul>
        {messages.map((message, index) => (
          <li key={`${String(message.offset ?? index)}-${index}`}>
            <code>{JSON.stringify(message.value)}</code>
          </li>
        ))}
      </ul>
    </section>
  )
}
