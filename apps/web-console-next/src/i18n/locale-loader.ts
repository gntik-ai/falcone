import { useSyncExternalStore } from 'react'
import i18n, { changeLocale, type Locale } from './index'

type Bundle = Record<string, unknown>
type Loader = (retry: boolean) => Promise<Bundle>
interface LocaleState { pending: boolean; error: boolean; target: Locale | null; revision: number }
const registrations = new Map<string, Record<Locale, Loader>>()
const listeners = new Set<() => void>()
let state: LocaleState = { pending: false, error: false, target: null, revision: 0 }
let inFlight: Promise<boolean> | null = null
function update(next: Partial<LocaleState>) {
  state = { ...state, ...next, revision: state.revision + 1 }
  listeners.forEach((listener) => listener())
}

// Register only mounted pages: leaving settings restores the menu's pass-through behavior.
export function registerLocaleBundles(namespace: string, loaders: Record<Locale, Loader>) {
  registrations.set(namespace, loaders)
  return () => {
    if (registrations.get(namespace) === loaders) registrations.delete(namespace)
    if (!registrations.size && !state.pending) update({ error: false, target: null })
  }
}
// Keep locale resources local and retryable under the existing self-only CSP.
export function createLocaleBundleLoader(importBundle: () => Promise<{ default: string }>, resourceUrl: string): Loader {
  let importFailed = false
  return async (retry) => {
    if (!retry && !importFailed) {
      try { return JSON.parse((await importBundle()).default) as Bundle }
      catch (cause) { importFailed = true; throw cause }
    }
    // Browsers remember failed module fetches. A local JSON asset bypasses that
    // module-map entry on retry and on subsequent switches in the same document.
    const response = await fetch(resourceUrl, { cache: 'reload' })
    if (!response.ok) throw new Error('Locale bundle unavailable')
    return await response.json() as Bundle
  }
}
export function useLocaleLoader() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state)
}
export function loadLocale(target: Locale): Promise<boolean> {
  if (inFlight) return inFlight
  const retry = state.error && state.target === target
  const active = [...registrations.entries()]
  update({ pending: true, target })
  inFlight = (async () => {
    try {
      // Commit resources and preference only after every registered bundle has loaded.
      const bundles = await Promise.all(active.map(async ([namespace, loaders]) => [namespace, await loaders[target](retry)] as const))
      for (const [namespace, bundle] of bundles) i18n.addResourceBundle(target, namespace, bundle, true, true)
      await changeLocale(target)
      update({ pending: false, error: false })
      return true
    } catch {
      update({ pending: false, error: true })
      return false
    } finally { inFlight = null }
  })()
  return inFlight
}
export function retryLocale() { return state.target ? loadLocale(state.target) : Promise.resolve(false) }
