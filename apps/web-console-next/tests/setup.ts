import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import i18n from '../src/i18n'
import { setConsoleSessionRetry401Invalidation } from '@in-falcone/console-api/session'

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('es')
  vi.stubGlobal('__APP_VERSION__', 'dev')
  vi.stubGlobal('__APP_COMMIT_SHA__', '')
  localStorage.clear()
  sessionStorage.clear()
  // Mirror main.tsx's opt-in for component tests, with fresh module state per test.
  setConsoleSessionRetry401Invalidation(false)
  setConsoleSessionRetry401Invalidation(true)
  document.documentElement.className = ''
})

afterEach(() => {
  cleanup()
  setConsoleSessionRetry401Invalidation(false)
})
