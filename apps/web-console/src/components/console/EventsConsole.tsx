// Events (Kafka) console (changes: add-console-events-data-editor, add-console-richer-data-editors).
// Lists/creates topics, publishes a message, and polls (consumes) recent messages via the
// control-plane executor (@/services/eventsApi), with loading + empty + status feedback.
import { useCallback, useEffect, useState } from 'react'
import { Inbox, LockKeyhole, Plus, RefreshCw, Send } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ApiError, JsonValue } from '@/lib/http'
import { cn } from '@/lib/utils'
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
  canManageEvents?: boolean
}

type EventOperation = 'create' | 'publish' | 'consume'

const panelClassName = 'rounded-2xl border border-border bg-card/60 p-4 shadow-sm sm:p-5'
const panelHeaderClassName = 'flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3'
const panelTitleClassName = 'text-base font-semibold tracking-tight text-foreground'
const panelDescriptionClassName = 'mt-1 text-xs leading-5 text-muted-foreground'
const emptyStateClassName = 'rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 text-sm leading-6 text-muted-foreground'
const codeBlockClassName = 'overflow-x-auto rounded-lg border border-border/60 bg-muted/30 p-3 font-mono text-xs leading-5 text-foreground'

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'Request failed'
}

export function EventsConsole({ workspaceId, canManageEvents = true }: EventsConsoleProps) {
  const [topics, setTopics] = useState<TopicRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [newTopic, setNewTopic] = useState('')
  const [selected, setSelected] = useState('')
  const [messageJson, setMessageJson] = useState('{"value":{}}')
  const [messages, setMessages] = useState<EventMessage[]>([])
  const [consumed, setConsumed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [operation, setOperation] = useState<EventOperation | null>(null)

  const reloadTopics = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listTopics(workspaceId)
      setTopics(result.items)
      setSelected((current) => result.items.some((topic) => topic.topic === current) ? current : '')
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
    const topicName = newTopic.trim()
    if (topicName === '') return
    setError(null)
    setStatus(null)
    setOperation('create')
    try {
      const created = await createTopic(workspaceId, topicName)
      const createdTopic = created.topic || topicName
      setStatus(`Topic "${createdTopic}" created`)
      setNewTopic('')
      await reloadTopics()
      setSelected(createdTopic)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setOperation(null)
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
    setOperation('publish')
    try {
      await publishMessage(workspaceId, selected, parsed)
      setStatus(`Published to "${selected}"`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setOperation(null)
    }
  }

  async function handleConsume() {
    if (selected === '') {
      setError('Select a topic to consume from')
      return
    }
    setError(null)
    setStatus(null)
    setOperation('consume')
    try {
      const result = await consumeMessages(workspaceId, selected, { maxMessages: 10, timeoutMs: 3000 })
      setMessages(result.items)
      setConsumed(true)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setOperation(null)
    }
  }

  function handleSelectTopic(topic: string) {
    setSelected(topic)
    setError(null)
    setStatus(null)
  }

  const busy = operation != null
  const selectedTopic = topics.find((topic) => topic.topic === selected) ?? null
  const canCreateTopic = canManageEvents && !busy && newTopic.trim() !== ''
  const canPublishMessage = canManageEvents && !busy && selected !== ''
  const canPollMessages = !busy && selected !== ''

  return (
    <section aria-label="Events console" aria-busy={loading || busy} className="space-y-4">
      {error ? (
        <Alert variant="destructive" aria-live="assertive" className="rounded-sm">
          <AlertTitle>Events request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {status ? (
        <Alert variant="success" role="status" aria-live="polite" className="rounded-sm">
          <AlertTitle>{status}</AlertTitle>
        </Alert>
      ) : null}

      {!canManageEvents ? (
        <div role="note" className="flex items-start gap-3 rounded-2xl border border-border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground shadow-sm">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
          <p>Event writes are restricted to workspace or tenant admins. You can still select a topic and poll messages.</p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.82fr)_minmax(0,1.18fr)]">
        <section aria-labelledby="events-topics-heading" className={panelClassName}>
          <div className={panelHeaderClassName}>
            <div>
              <h3 id="events-topics-heading" className={panelTitleClassName}>
                Topics{topics.length > 0 ? ` (${topics.length})` : ''}
              </h3>
              <p className={panelDescriptionClassName}>Select a workspace topic before publishing or polling messages.</p>
            </div>
            <Badge variant={selectedTopic ? 'secondary' : 'outline'} className="max-w-full truncate px-3 py-1">
              {selectedTopic ? `Selected: ${selectedTopic.topic}` : 'No topic selected'}
            </Badge>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Loading topics…</p>
            ) : topics.length === 0 ? (
              <div className={emptyStateClassName}>
                <p>No topics yet.</p>
              </div>
            ) : (
              <fieldset className="space-y-2" aria-describedby="selected-topic-summary">
                <legend className="sr-only">Available event topics</legend>
                {topics.map((topic) => {
                  const isSelected = selected === topic.topic
                  return (
                    <label
                      key={topic.topic}
                      className={cn(
                        'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl border border-border/80 bg-background/40 p-3 text-sm transition-colors hover:border-border hover:bg-muted/40 sm:grid-cols-[auto_minmax(0,1fr)_auto]',
                        isSelected && 'border-primary/70 bg-primary/10 shadow-sm'
                      )}
                    >
                      <input
                        type="radio"
                        name="topic"
                        value={topic.topic}
                        checked={isSelected}
                        onChange={() => handleSelectTopic(topic.topic)}
                        aria-label={topic.topic}
                        className="row-span-2 h-4 w-4 accent-primary"
                      />
                      <span className="min-w-0 truncate font-medium text-foreground">{topic.topic}</span>
                      {topic.partitions != null ? (
                        <Badge variant="outline" className="col-start-2 w-fit justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-end">
                          {topic.partitions} partitions
                        </Badge>
                      ) : null}
                      <span className="col-start-2 text-xs text-muted-foreground sm:col-span-2">Workspace topic</span>
                    </label>
                  )
                })}
              </fieldset>
            )}

            <p id="selected-topic-summary" className="text-sm text-muted-foreground" aria-live="polite">
              {selectedTopic ? `Selected topic: ${selectedTopic.topic}.` : 'No topic selected.'}
            </p>
          </div>
        </section>

        <div className="space-y-4">
          {canManageEvents ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="events-create-heading" className={panelClassName}>
                <div className={panelHeaderClassName}>
                  <div>
                    <h3 id="events-create-heading" className={panelTitleClassName}>Create topic</h3>
                    <p className={panelDescriptionClassName}>Admin-only structural write for this workspace.</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="new-topic">New topic</Label>
                    <Input
                      id="new-topic"
                      value={newTopic}
                      onChange={(event) => setNewTopic(event.target.value)}
                      placeholder="orders"
                      aria-describedby="new-topic-help"
                      disabled={busy}
                    />
                  </div>
                  <p id="new-topic-help" className="sr-only">Topic name to add to the selected workspace.</p>
                  <Button type="button" className="w-full sm:w-auto" onClick={() => void handleCreateTopic()} disabled={!canCreateTopic}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {operation === 'create' ? 'Creating…' : 'Create topic'}
                  </Button>
                </div>
              </section>

              <section aria-labelledby="events-publish-heading" className={panelClassName}>
                <div className={panelHeaderClassName}>
                  <div>
                    <h3 id="events-publish-heading" className={panelTitleClassName}>Publish</h3>
                    <p className={panelDescriptionClassName}>Send a JSON test message to the selected topic.</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <Label htmlFor="message-json">Message (JSON, e.g. {'{ "value": { ... } }'})</Label>
                  <Textarea
                    id="message-json"
                    value={messageJson}
                    onChange={(event) => setMessageJson(event.target.value)}
                    aria-describedby="selected-topic-summary message-json-help"
                    aria-invalid={error === 'Message is not valid JSON' ? true : undefined}
                    className="min-h-28 rounded-sm font-mono text-xs leading-5"
                    disabled={busy}
                  />
                  <p id="message-json-help" className="sr-only">JSON object containing a value field and optional key.</p>
                  <Button type="button" className="w-full sm:w-auto" onClick={() => void handlePublish()} disabled={!canPublishMessage}>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {operation === 'publish' ? 'Publishing…' : 'Publish'}
                  </Button>
                </div>
              </section>
            </div>
          ) : null}

          <section aria-labelledby="events-consume-heading" className={panelClassName} aria-live="polite">
            <div className={panelHeaderClassName}>
              <div>
                <h3 id="events-consume-heading" className={panelTitleClassName}>Consume</h3>
                <p className={panelDescriptionClassName}>Poll the selected topic without requiring write access.</p>
              </div>
              <Badge variant="outline" className="px-3 py-1">
                {messages.length > 0 ? `${messages.length} messages` : 'No messages loaded'}
              </Badge>
            </div>
            <div className="mt-4 space-y-4">
              <Button type="button" className="w-full sm:w-auto" onClick={() => void handleConsume()} disabled={!canPollMessages}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {operation === 'consume' ? 'Polling…' : 'Poll messages'}
              </Button>

              {operation === 'consume' ? (
                <p role="status" className="text-sm text-muted-foreground">Polling messages…</p>
              ) : consumed && messages.length === 0 ? (
                <p className={emptyStateClassName}>No messages.</p>
              ) : messages.length > 0 ? (
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {messages.map((message, index) => (
                    <li key={`${String(message.offset ?? index)}-${index}`} className="rounded-xl border border-border/80 bg-background/40 p-3 text-sm shadow-sm">
                      <pre className={codeBlockClassName}>{JSON.stringify(message.value, null, 2)}</pre>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {message.key != null ? <span>key={message.key}</span> : null}
                        {message.partition != null ? <span>partition={String(message.partition)}</span> : null}
                        {message.offset != null ? <span>offset={String(message.offset)}</span> : null}
                        {message.timestamp ? <span>{message.timestamp}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={emptyStateClassName}>
                  <Inbox className="mb-2 h-4 w-4" aria-hidden="true" />
                  <p>No message poll run yet.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
