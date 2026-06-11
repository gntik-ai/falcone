// Events (Kafka) console (changes: add-console-events-data-editor, add-console-richer-data-editors).
// Lists/creates topics, publishes a message, and polls (consumes) recent messages via the
// control-plane executor (@/services/eventsApi), with loading + empty + status feedback.
import { useCallback, useEffect, useState } from 'react'

import type { ApiError, JsonValue } from '@/lib/http'
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
  const [loading, setLoading] = useState(true)
  const [newTopic, setNewTopic] = useState('')
  const [selected, setSelected] = useState('')
  const [messageJson, setMessageJson] = useState('{"value":{}}')
  const [messages, setMessages] = useState<EventMessage[]>([])
  const [consumed, setConsumed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadTopics = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listTopics(workspaceId)
      setTopics(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void reloadTopics()
  }, [reloadTopics])

  async function handleCreateTopic() {
    if (newTopic.trim() === '') return
    setError(null)
    setStatus(null)
    setBusy(true)
    try {
      await createTopic(workspaceId, newTopic.trim())
      setStatus(`Topic "${newTopic.trim()}" created`)
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
    setStatus(null)
    let parsed: { key?: string; value: JsonValue }
    try {
      parsed = JSON.parse(messageJson) as { key?: string; value: JsonValue }
    } catch {
      setError('Message is not valid JSON')
      return
    }
    setBusy(true)
    try {
      await publishMessage(workspaceId, selected, parsed)
      setStatus(`Published to "${selected}"`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleConsume() {
    if (selected === '') {
      setError('Select a topic to consume from')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const result = await consumeMessages(workspaceId, selected, { maxMessages: 10, timeoutMs: 3000 })
      setMessages(result.items)
      setConsumed(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Events console">
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}

      <h3>Topics{topics.length > 0 ? ` (${topics.length})` : ''}</h3>
      {loading ? (
        <p>Loading topics…</p>
      ) : topics.length === 0 ? (
        <p>No topics yet.</p>
      ) : (
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
      )}
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
      {consumed && messages.length === 0 ? <p>No messages.</p> : null}
      <ul>
        {messages.map((message, index) => (
          <li key={`${String(message.offset ?? index)}-${index}`}>
            <code>{JSON.stringify(message.value)}</code>
            {message.key != null ? <span> key={message.key}</span> : null}
            {message.offset != null ? <span> offset={String(message.offset)}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
