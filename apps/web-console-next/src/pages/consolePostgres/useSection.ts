import { useCallback, useEffect, useRef, useState } from 'react'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { failureOf, pageUrl, type Failure } from './api'
export type Collection<T> = { items?: T[]; page?: { nextCursor?: string | null } }
// Each section owns its request generation and cursor stack. A late response cannot restore a cleared selection.
export function useSection<T>(path: string | null, paged = true, scope: string | null = null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; busy: boolean; error: Failure | null }>({ path, data: null, busy: Boolean(path), error: null })
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const generation = useRef(0), live = useRef(true), currentPath = useRef(path)
  currentPath.current = path
  const load = useCallback(async (cursor: string | null, stack: (string | null)[], retry = false) => {
    if (!path) return
    const token = ++generation.current
    setState({ path, data: null, busy: true, error: null }); setCursors(stack)
    try {
      const data = await requestConsoleSessionJson<T>(paged ? pageUrl(path, cursor) : path)
      if (live.current && generation.current === token && currentPath.current === path) {
        setState({ path, data, busy: false, error: null })
        if (retry) requestAnimationFrame(() => document.getElementById(`pg-${path}`)?.focus())
      }
    } catch (cause) {
      if (live.current && generation.current === token && currentPath.current === path) setState({ path, data: null, busy: false, error: failureOf(cause) })
    }
  }, [path, paged, scope])
  useEffect(() => {
    live.current = true
    setCursors([null])
    if (path) void load(null, [null])
    else setState({ path, data: null, busy: false, error: null })
    return () => { live.current = false; generation.current++ }
  }, [load, path])
  const data = state.path === path ? state.data : null
  const next = paged ? (data as Collection<unknown> | null)?.page?.nextCursor : null
  return { path, data, busy: Boolean(path) && (state.path !== path || state.busy), error: state.path === path ? state.error : null, previous: cursors.length > 1, next,
    retry: () => void load(cursors[cursors.length - 1], cursors, true),
    forward: () => { if (next) void load(next, [...cursors, next]) },
    back: () => { if (cursors.length > 1) { const stack = cursors.slice(0, -1); void load(stack[stack.length - 1], stack) } },
  }
}
export type Section<T> = ReturnType<typeof useSection<T>>
