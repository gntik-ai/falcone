import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

ensureWebStorage('localStorage')
ensureWebStorage('sessionStorage')

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', 'dev')
  vi.stubGlobal('__APP_COMMIT_SHA__', '')
})

afterEach(() => {
  cleanup()
})

function ensureWebStorage(property: 'localStorage' | 'sessionStorage') {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (window[property]) {
      return
    }
  } catch {
    // Install the fallback below when jsdom exposes an unavailable storage getter.
  }

  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => {
      values.clear()
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, String(value))
    }
  }

  Object.defineProperty(window, property, {
    configurable: true,
    value: storage
  })
}
