import { useEffect, useRef, useState } from 'react'
import { failureOf, list, security, type Collection, type Failure } from './api'

type Snapshot<T> = { data: T | null; loading: boolean; failure: Failure | null }
// Each mounted section owns one cursor stack and one request. StrictMode reuses its pending read.
// Retiring a section prevents late results from crossing a database/schema/workspace boundary.
function useRead<T>(path: string | null, read: (path: string, cursor: string | null) => Promise<T>) {
  const [state, setState] = useState<Snapshot<T>>({ data: null, loading: Boolean(path), failure: null })
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [revision, setRevision] = useState(0)
  const cached = useRef<{ path: string; cursor: string | null; revision: number; promise: Promise<T> } | null>(null)
  const busy = useRef(false)
  const recovered = useRef(false)
  const region = useRef<HTMLElement>(null)
  const cursor = cursors[cursors.length - 1]
  useEffect(() => {
    let live = true
    if (!path) { setState({ data: null, loading: false, failure: null }); return }
    busy.current = true
    setState({ data: null, loading: true, failure: null })
    if (!cached.current || cached.current.path !== path || cached.current.cursor !== cursor || cached.current.revision !== revision) {
      cached.current = { path, cursor, revision, promise: read(path, cursor) }
    }
    void cached.current.promise.then((data) => {
      if (live) setState({ data, loading: false, failure: null })
    }).catch((cause: unknown) => {
      if (live) setState({ data: null, loading: false, failure: failureOf(cause) })
    }).finally(() => { if (live) busy.current = false })
    return () => { live = false }
  }, [path, cursor, revision, read])
  useEffect(() => {
    if (!state.loading && !state.failure && recovered.current) {
      recovered.current = false
      region.current?.focus()
    }
  }, [state])
  const reload = () => { if (!busy.current) { recovered.current = true; setRevision((value) => value + 1) } }
  const next = (value: string) => { if (!busy.current) { recovered.current = true; setCursors((stack) => [...stack, value]) } }
  const previous = () => { if (!busy.current && cursors.length > 1) { recovered.current = true; setCursors((stack) => stack.slice(0, -1)) } }
  return { ...state, reload, next, previous, hasPrevious: cursors.length > 1, region }
}
const readSecurity = (path: string) => security(path)
export const useSecurity = (path: string) => useRead(path, readSecurity)
export function useList<T>(path: string) { return useRead<Collection<T>>(path, list<T>) }
export type ListState<T> = ReturnType<typeof useList<T>>
