import { useCallback, useEffect, useRef, useState } from 'react'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { failureOf, isAbort, type Collection, type Failure } from './api'

// Every section owns one AbortController. A new key (selection, workspace, tenant) or an unmount aborts the
// in-flight request, so a late response can neither restore a cleared selection nor raise an error.
export type ListState<T> = { key: string | null; items: T[]; cursor: string | null; busy: boolean; error: Failure | null; moreBusy: boolean; moreError: Failure | null }
const idle = <T,>(key: string | null): ListState<T> => ({ key, items: [], cursor: null, busy: Boolean(key), error: null, moreBusy: false, moreError: null })

export function useCursorList<T>(key: string | null, urlFor: (cursor: string | null) => string) {
  const [state, setState] = useState<ListState<T>>(() => idle<T>(key))
  const controller = useRef<AbortController | null>(null)
  const url = useRef(urlFor)
  url.current = urlFor
  const run = useCallback(async (cursor: string | null) => {
    if (!key) return
    controller.current?.abort()
    const own = new AbortController()
    controller.current = own
    const more = cursor !== null
    setState((previous) => more && previous.key === key ? { ...previous, moreBusy: true, moreError: null } : idle<T>(key))
    try {
      const page = await requestConsoleSessionJson<Collection<T>>(url.current(cursor), { signal: own.signal })
      if (own.signal.aborted) return
      setState((previous) => ({ key, items: more ? [...previous.items, ...(page?.items ?? [])] : page?.items ?? [], cursor: page?.page?.nextCursor ?? page?.page?.after ?? null, busy: false, error: null, moreBusy: false, moreError: null }))
    } catch (cause) {
      if (own.signal.aborted || isAbort(cause)) return
      const failure = failureOf(cause)
      setState((previous) => more ? { ...previous, moreBusy: false, moreError: failure } : { ...idle<T>(key), busy: false, error: failure })
    }
  }, [key])
  useEffect(() => {
    if (key) void run(null)
    else setState(idle<T>(null))
    return () => controller.current?.abort()
  }, [key, run])
  // A render that sees a new key before the effect runs must not show the previous selection's rows.
  const view = state.key === key ? state : idle<T>(key)
  return { ...view, reload: () => run(null), more: () => { if (view.cursor !== null && !view.moreBusy) return run(view.cursor) } }
}
export type CursorList<T> = ReturnType<typeof useCursorList<T>>

type OneState<T> = { key: string | null; data: T | null; busy: boolean; error: Failure | null }
export function useOne<T>(key: string | null, path: string) {
  const [state, setState] = useState<OneState<T>>({ key, data: null, busy: Boolean(key), error: null })
  const controller = useRef<AbortController | null>(null)
  const target = useRef(path)
  target.current = path
  const run = useCallback(async () => {
    if (!key) return
    controller.current?.abort()
    const own = new AbortController()
    controller.current = own
    setState({ key, data: null, busy: true, error: null })
    try {
      const data = await requestConsoleSessionJson<T>(target.current, { signal: own.signal })
      if (!own.signal.aborted) setState({ key, data, busy: false, error: null })
    } catch (cause) {
      if (own.signal.aborted || isAbort(cause)) return
      setState({ key, data: null, busy: false, error: failureOf(cause) })
    }
  }, [key])
  useEffect(() => {
    if (key) void run()
    else setState({ key: null, data: null, busy: false, error: null })
    return () => controller.current?.abort()
  }, [key, run])
  const view = state.key === key ? state : { key, data: null, busy: Boolean(key), error: null }
  return { ...view, reload: run }
}
export type One<T> = ReturnType<typeof useOne<T>>
