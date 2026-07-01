import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FlowPalette } from './FlowPalette'

const listTaskTypes = vi.hoisted(() => vi.fn())

vi.mock('@/services/taskTypeRegistryApi', () => ({
  listTaskTypes: (...args: unknown[]) => listTaskTypes(...args)
}))

describe('FlowPalette', () => {
  beforeEach(() => {
    listTaskTypes.mockReset()
  })

  it('muestra el estado vacío del catálogo en español', async () => {
    listTaskTypes.mockResolvedValueOnce([])

    render(<FlowPalette workspaceId="wrk_1" />)

    expect(await screen.findByText('El catálogo de tipos de tarea está vacío.')).toBeInTheDocument()
  })
})
