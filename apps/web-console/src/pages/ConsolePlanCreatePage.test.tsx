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
    await userEvent.type(screen.getByLabelText(/nombre visible/i), 'Starter')
    await userEvent.click(screen.getByRole('button', { name: /crear/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/formato del slug/i)
    expect(createPlan).not.toHaveBeenCalled()
  })

  it('validates required display name inline and does not create a plan — issue #807', async () => {
    render(<MemoryRouter><ConsolePlanCreatePage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText(/slug/i), 'starter')
    await userEvent.type(screen.getByLabelText(/nombre visible/i), '   ')
    await userEvent.click(screen.getByRole('button', { name: /crear/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/nombre visible es obligatorio/i)
    expect(createPlan).not.toHaveBeenCalled()
  })

  it('focuses and clears the display name validation state when corrected', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ConsolePlanCreatePage /></MemoryRouter>)
    await user.type(screen.getByLabelText(/slug/i), 'starter')
    const displayNameInput = screen.getByLabelText(/nombre visible/i)
    await user.type(displayNameInput, '   ')
    await user.click(screen.getByRole('button', { name: /crear/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/nombre visible es obligatorio/i)
    expect(displayNameInput).toHaveFocus()
    expect(displayNameInput).toHaveClass('border-destructive')

    await user.type(displayNameInput, 'Starter')

    expect(screen.queryByText(/nombre visible es obligatorio/i)).not.toBeInTheDocument()
    expect(displayNameInput).not.toHaveClass('border-destructive')
  })
})
