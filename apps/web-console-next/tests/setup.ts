import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import i18n from '../src/i18n'
import { invalidateConsoleShellSession, setConsoleSessionRetryUnauthorizedHandler } from '@in-falcone/console-api/session'

beforeEach(async () => {
  vi.restoreAllMocks()
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
  setConsoleSessionRetryUnauthorizedHandler(null)
})
