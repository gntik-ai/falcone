import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Button } from './button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog'

function DialogHarness({ closeOnInteractOutside = false }: { closeOnInteractOutside?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <Button type="button" onClick={() => setOpen(true)}>Abrir modal</Button>
      <a href="/outside">Enlace externo</a>
      <Dialog open={open} onOpenChange={setOpen} closeOnInteractOutside={closeOnInteractOutside}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modal accesible</DialogTitle>
            <DialogDescription>Describe el propósito del modal.</DialogDescription>
          </DialogHeader>
          <label htmlFor="dialog-name">Nombre</label>
          <input id="dialog-name" />
          <DialogFooter>
            <Button type="button" variant="outline">Acción secundaria</Button>
            <DialogClose asChild>
              <Button type="button">Cerrar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

describe('Dialog', () => {
  it('[#753] renders an announced modal with aria wiring', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole('button', { name: /abrir modal/i }))

    const dialog = await screen.findByRole('dialog', { name: /modal accesible/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Describe el propósito del modal.')
    expect(screen.getByLabelText('Nombre')).toHaveFocus()
  })

  it('[#753] traps Tab inside the modal and restores focus after close', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    const trigger = screen.getByRole('button', { name: /abrir modal/i })
    await user.click(trigger)
    const nameInput = await screen.findByLabelText('Nombre')
    await waitFor(() => expect(nameInput).toHaveFocus())

    await user.tab()
    expect(screen.getByRole('button', { name: /acción secundaria/i })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: /^cerrar$/i })).toHaveFocus()
    await user.tab()
    expect(nameInput).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: /^cerrar$/i })).toHaveFocus()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /modal accesible/i })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('[#753] ignores backdrop clicks by default, with opt-in outside close still available', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DialogHarness />)

    await user.click(screen.getByRole('button', { name: /abrir modal/i }))
    let dialog = await screen.findByRole('dialog', { name: /modal accesible/i })
    fireEvent.click(dialog.parentElement!)
    expect(screen.getByRole('dialog', { name: /modal accesible/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^cerrar$/i }))
    rerender(<DialogHarness closeOnInteractOutside />)
    await user.click(screen.getByRole('button', { name: /abrir modal/i }))
    dialog = await screen.findByRole('dialog', { name: /modal accesible/i })
    fireEvent.click(dialog.parentElement!)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /modal accesible/i })).not.toBeInTheDocument())
  })
})
