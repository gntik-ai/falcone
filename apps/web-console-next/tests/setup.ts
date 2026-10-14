import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', 'dev')
  vi.stubGlobal('__APP_COMMIT_SHA__', '')
  localStorage.clear()
  document.documentElement.className = ''
})

afterEach(cleanup)
