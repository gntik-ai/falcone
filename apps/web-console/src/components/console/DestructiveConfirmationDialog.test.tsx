import { useState } from 'react'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DestructiveConfirmationDialog } from './DestructiveConfirmationDialog'

import { FIXTURE_TENANT_BETA } from '@/test/fixtures/tenants'
import type { DestructiveOpConfig } from '@/lib/destructive-ops'

afterEach(() => {
  cleanup()
})

function buildConfig(overrides: Partial<DestructiveOpConfig> = {}): DestructiveOpConfig {
  return {
    level: 'CRITICAL',
    operationId: 'delete-tenant',
    resourceName: 'Tenant Alpha',
    resourceType: 'tenant',
    resourceId: 'ten_1',
    cascadeImpact: [],
    cascadeImpactError: false,
    onConfirm: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('DestructiveConfirmationDialog', () => {
  it('en CRITICAL deshabilita confirm con input vacío y exige coincidencia exacta', async () => {
    const user = userEvent.setup()
    render(<DestructiveConfirmationDialog open config={buildConfig()} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)

    const confirmButton = screen.getByRole('button', { name: /^eliminar$/i })
    const input = screen.getByRole('textbox')

    expect(confirmButton).toBeDisabled()

    await user.type(input, 'Tenant')
    expect(confirmButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Tenant Alpha')
    expect(confirmButton).toBeEnabled()
  })

  it('[RC-03] muestra resumen de cascada en CRITICAL — RF-UI-026 / T03-AC3', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ cascadeImpact: [{ resourceType: 'workspace', count: 2 }, { resourceType: 'database', count: 5 }] })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('workspace / 2')).toBeInTheDocument()
    expect(screen.getByText('database / 5')).toBeInTheDocument()
  })

  it('muestra degradación cuando falla el cálculo de cascada', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ cascadeImpactError: true })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/no se pudo calcular el impacto completo/i)).toBeInTheDocument()
  })

  it('en WARNING no muestra input adicional', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING', operationId: 'detach-provider', resourceName: 'Corporate OIDC', resourceType: 'provider federado', impactDescription: 'El provider dejará de estar asociado a la aplicación actual.' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText(/esta operación no se puede deshacer/i)).toBeInTheDocument()
  })

  it('deshabilita ambos botones mientras confirma', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="confirming" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /confirmar|eliminar/i })).toBeDisabled()
  })

  it('muestra el error inline', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="error" confirmError="Backend exploded" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/backend exploded/i)
  })

  it('pone el foco inicial en cancelar', async () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancelar/i })).toHaveFocus()
    })
  })

  it('[RC-06] click fuera del modal cierra el diálogo — RF-UI-026 / T03-AC6', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={onCancel} />)

    const overlay = screen.getByRole('alertdialog').closest('.fixed')
    if (!overlay) throw new Error('No overlay found')

    await user.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cierra con Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={onCancel} />)
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('[RC-07] al confirmar delega en onConfirm una sola vez y NO dispara onSuccess por su cuenta — RF-UI-026 / T03-AC7', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    render(<DestructiveConfirmationDialog open config={buildConfig({ level: 'WARNING', onSuccess })} opState="ready" confirmError={null} onConfirm={onConfirm} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    // The dialog is presentational: it triggers the op exactly once and never runs the
    // success side effects itself. The hook (useDestructiveOp.handleConfirm) owns awaiting
    // the op and firing config.onSuccess once on success — see the integration test.
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('[RC-10] no se abren dos diálogos simultáneamente — RF-UI-026 / T03-AC10', () => {
    render(
      <>
        <DestructiveConfirmationDialog open config={buildConfig({ operationId: 'one' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />
        <DestructiveConfirmationDialog open={false} config={buildConfig({ operationId: 'two', resourceName: 'Tenant Two' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>
    )

    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(screen.queryByText(/tenant two/i)).not.toBeInTheDocument()
  })

  it('aisla el contexto multi-tenant activo', () => {
    render(<DestructiveConfirmationDialog open config={buildConfig({ resourceName: 'Tenant Alpha' })} opState="ready" confirmError={null} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(FIXTURE_TENANT_BETA.name)).not.toBeInTheDocument()
    expect(screen.queryByText(FIXTURE_TENANT_BETA.tenantId)).not.toBeInTheDocument()
  })

  // #783 scenario 3: the dialog is focus-trapped (Tab cycles within it, never escaping to the
  // page behind it) and returns focus to whatever triggered it once it closes. The `ui/dialog.tsx`
  // primitive provides neither (bare backdrop overlay) — RED on main: Tab moves focus out of the
  // dialog because there is no keydown handler on the panel to intercept it.
  it('[#783] atrapa el foco con Tab y lo devuelve al disparador al cancelar', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            abrir revocación
          </button>
          <DestructiveConfirmationDialog
            open={open}
            config={open ? buildConfig({ level: 'WARNING' }) : null}
            opState="ready"
            confirmError={null}
            onConfirm={vi.fn()}
            onCancel={() => setOpen(false)}
          />
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /abrir revocación/i })
    await user.click(trigger)

    const cancelButton = await screen.findByRole('button', { name: /cancelar/i })
    const confirmButton = screen.getByRole('button', { name: /confirmar/i })

    // Focus starts inside the dialog (on the first focusable element).
    await waitFor(() => expect(cancelButton).toHaveFocus())

    // Tab from the last focusable element wraps back to the first — it never leaves the dialog.
    confirmButton.focus()
    await user.tab()
    expect(cancelButton).toHaveFocus()

    // Shift+Tab from the first wraps to the last.
    await user.tab({ shift: true })
    expect(confirmButton).toHaveFocus()

    // Closing (Cancelar) returns focus to the control that opened the dialog.
    await user.click(cancelButton)
    expect(trigger).toHaveFocus()
  })
})
