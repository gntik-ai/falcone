import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import i18n from '../src/i18n'

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('es')
  vi.stubGlobal('__APP_VERSION__', 'dev')
  vi.stubGlobal('__APP_COMMIT_SHA__', '')
  localStorage.clear()
  document.documentElement.className = ''
})

afterEach(cleanup)
