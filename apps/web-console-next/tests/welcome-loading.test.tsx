import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { App } from '../src/App'

const held = vi.hoisted(() => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  return { pending, release }
})
vi.mock('../src/pages/welcome', async (original) => {
  await held.pending
  return original()
})

test('the pending welcome chunk has one loading announcement and one main without requests', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  render(<MemoryRouter><App /></MemoryRouter>)
  const loading = screen.getAllByRole('status').filter((node) => node.textContent === 'Cargando')
  expect(loading).toHaveLength(1)
  expect(loading[0]).toHaveAttribute('aria-busy', 'true')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  await act(async () => { held.release() })
  expect(await screen.findByRole('heading', { name: 'In Falcone Console' })).toBeVisible()
  expect(loading[0]).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})
