import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from './api'
import type { Failure } from './api'
import type { KafkaStreamEvent } from './types'
import { useCopy } from './copy'

export function useSection<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: Failure | null }>({ data: null, loading: true, error: null })
  const controller = useRef<AbortController | null>(null)
  const reload = useCallback(async () => {
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    setState((previous) => ({ ...previous, loading: true }))
    try {
      const data = await load(current.signal)
      if (!current.signal.aborted) setState({ data, loading: false, error: null })
    } catch (cause) {
      if (!current.signal.aborted) setState({ data: null, loading: false, error: api.failureOf(cause) })
    }
  }, [load])
  useEffect(() => {
    let active = true
    // Avoid duplicate requests during StrictMode effect replay.
    void Promise.resolve().then(() => { if (active) void reload() })
    return () => { active = false; controller.current?.abort() }
  }, [reload])
  return { ...state, reload }
}
export function useStream(resourceId: string) {
  const { t } = useCopy()
  const [active, setActive] = useState(false), [events, setEvents] = useState<Array<KafkaStreamEvent & { id: string }>>([])
  const [error, setError] = useState<(Failure & { fallback: string }) | null>(null), [highVolume, setHighVolume] = useState(false)
  const controller = useRef<AbortController | null>(null), sequence = useRef(0)
  const stop = useCallback(() => { controller.current?.abort(); controller.current = null; setActive(false) }, [])
  useEffect(() => () => { controller.current?.abort(); controller.current = null }, [resourceId])
  async function start() {
    stop()
    const token = api.streamToken()
    if (!token) { setError({ fallback: 'sessionUnavailableSignInAgain' }); return }
    const current = new AbortController(); controller.current = current
    setEvents([]); setError(null); setHighVolume(false); setActive(true)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const abortReader = () => { void reader?.cancel().catch(() => undefined) }
    current.signal.addEventListener('abort', abortReader, { once: true })
    try {
      const response = await api.stream(resourceId, token, current.signal)
      if (current.signal.aborted) { await response.body?.cancel(); return }
      if (!response.ok) { setError({ status: response.status, fallback: 'couldNotStartTheStream' }); await response.body?.cancel(); return }
      if (!response.body) { setError({ fallback: 'theStreamReturnedNoReadableContent' }); return }
      reader = response.body.getReader()
      const decoder = new TextDecoder(); let buffer = ''; let times: number[] = []
      while (!current.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:') || current.signal.aborted) continue
          const raw = line.slice(5).trim(); let payload: unknown = raw; let key: string | undefined, eventType: string | undefined
          try {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') { payload = 'payload' in parsed ? parsed.payload : parsed; key = typeof parsed.key === 'string' ? parsed.key : undefined; eventType = typeof parsed.eventType === 'string' ? parsed.eventType : typeof parsed.type === 'string' ? parsed.type : undefined }
          } catch { /* Non-JSON events remain readable as raw text. */ }
          const now = Date.now(); times = [...times.filter((time) => now - time < 1000), now]
          setHighVolume(times.length > 10)
          const id = String(++sequence.current)
          setEvents((previous) => [{ id, receivedAt: new Date(now).toISOString(), raw, payload, key, eventType }, ...previous].slice(0, 100))
        }
      }
    } catch {
      if (!current.signal.aborted) setError({ fallback: 'theStreamConnectionFailed' })
    } finally {
      current.signal.removeEventListener('abort', abortReader)
      try { await reader?.cancel() } catch { /* A dropped transport has already closed its reader. */ }
      reader?.releaseLock()
      current.abort()
      if (controller.current === current) { controller.current = null; setActive(false) }
    }
  }
  return { active, events, error: error ? statusMessage(t, error, error.fallback) : null, highVolume, start, stop }
}
// Preserve the legacy status mapping, including its section-specific network fallback.
export function statusMessage(t: (key: string) => string, error: Failure, fallback: string) {
  const key = error.status === 401 ? 'errors.unauthorized' : error.status === 403 ? 'errors.forbidden' : error.status === 404 ? 'errors.notFound' : error.status === 409 ? 'errors.conflict' : error.status === 429 ? 'errors.rateLimited' : error.status && error.status >= 500 ? 'errors.server' : fallback
  return t(key)
}
