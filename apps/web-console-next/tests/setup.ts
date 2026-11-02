import '@testing-library/jest-dom/vitest'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import i18n from '../src/i18n'
import { invalidateConsoleShellSession, setConsoleSessionRetryUnauthorizedHandler } from '@in-falcone/console-api/session'

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const pendingTimers = new Set<ReturnType<typeof setTimeout>>()

// Kit components may leave a timer running after unmount; it must not fire once jsdom is torn down.
function trackRealTimers() {
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const timer = realSetTimeout(handler, timeout, ...args)
    pendingTimers.add(timer)
    return timer
  }) as typeof setTimeout
}

beforeEach(async () => {
  vi.restoreAllMocks()
  trackRealTimers()
  // Component tests render below main.tsx; mirror its next-only bootstrap opt-in.
  setConsoleSessionRetryUnauthorizedHandler(invalidateConsoleShellSession)
  await i18n.changeLanguage('es')
  vi.stubGlobal('__APP_VERSION__', 'dev')
  vi.stubGlobal('__APP_COMMIT_SHA__', '')
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.className = ''
})

afterEach(() => {
  cleanup()
  if (vi.isFakeTimers()) {
    // Run what the test left pending while the environment is alive, then hand back the real timers.
    act(() => { vi.runOnlyPendingTimers() })
    vi.useRealTimers()
  }
  // Real timers still pending after unmount are cancelled; nothing is awaited, so the suite pays no extra time.
  for (const timer of pendingTimers) realClearTimeout(timer)
  pendingTimers.clear()
  globalThis.setTimeout = realSetTimeout
  setConsoleSessionRetryUnauthorizedHandler(null)
})
