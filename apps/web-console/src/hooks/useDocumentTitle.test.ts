import '@testing-library/jest-dom/vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useDocumentTitle } from './useDocumentTitle'

describe('useDocumentTitle', () => {
  afterEach(() => cleanup())

  it('sets document.title to the given value while mounted', () => {
    const { unmount } = renderHook(() => useDocumentTitle('Acceso · Consola In Falcone'))

    expect(document.title).toBe('Acceso · Consola In Falcone')

    unmount()
  })

  it('updates document.title when the title argument changes', () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'Acceso · Consola In Falcone' }
    })

    expect(document.title).toBe('Acceso · Consola In Falcone')

    rerender({ title: 'Solicitar acceso · Consola In Falcone' })

    expect(document.title).toBe('Solicitar acceso · Consola In Falcone')
  })

  it('[#731] restores the previous title on unmount, so leaving the unauthenticated funnel does not leak a stale title', () => {
    document.title = 'Consola In Falcone'

    const { unmount } = renderHook(() => useDocumentTitle('Acceso · Consola In Falcone'))
    expect(document.title).toBe('Acceso · Consola In Falcone')

    unmount()

    expect(document.title).toBe('Consola In Falcone')
  })
})
