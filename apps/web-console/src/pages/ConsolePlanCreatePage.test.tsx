import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsolePlanCreatePage } from './ConsolePlanCreatePage'

const { createPlan } = vi.hoisted(() => ({
  createPlan: vi.fn().mockResolvedValue({ id: 'p1' })
}))
vi.mock('@/services/planManagementApi', () => ({ createPlan }))

beforeEach(() => {
  createPlan.mockClear()
})

describe('ConsolePlanCreatePage', () => {
  it('validates slug format', async () => {
    render(<MemoryRouter><ConsolePlanCreatePage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/slug/i), 'Bad Slug')
    await userEvent.type(screen.getByLabelText(/display-name/i), 'Starter')
    await userEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/slug format/i)
    expect(createPlan).not.toHaveBeenCalled()
  })

  it('validates required display name inline and does not create a plan — issue #807', async () => {
    render(<MemoryRouter><ConsolePlanCreatePage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/slug/i), 'starter')
    await userEvent.type(screen.getByLabelText(/display-name/i), '   ')
    await userEvent.click(screen.getByRole('button', { name: /create/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/display name is required/i)
    expect(createPlan).not.toHaveBeenCalled()
  })
})
