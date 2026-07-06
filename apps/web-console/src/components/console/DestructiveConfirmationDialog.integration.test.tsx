import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DestructiveConfirmationDialog } from './DestructiveConfirmationDialog'
import { useDestructiveOp } from './hooks/useDestructiveOp'

import type { DestructiveOpConfig } from '@/lib/destructive-ops'

afterEach(() => {
  cleanup()
})

// Faithful WHEN/THEN encoding of issue #780: wire the REAL useDestructiveOp hook to the
// REAL DestructiveConfirmationDialog exactly as ConsoleServiceAccountsPage / ConsoleAuthPage
// do (the page passes `onConfirm={() => void destructiveOp.handleConfirm()}`). Nothing is
// mocked here — the test exercises the actual composition so it cannot pass artificially.
//
// `level: 'WARNING'` is used so no confirmation-text input is required and openDialog takes
// the early-return path (no cascade-impact fetch), keeping the harness network-free.
function Harness({ config }: { config: Omit<DestructiveOpConfig, 'cascadeImpact' | 'cascadeImpactError'> }) {
  const destructiveOp = useDestructiveOp()

  return (
    <>
      <button type="button" onClick={() => destructiveOp.openDialog(config)}>
        open
      </button>
      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </>
  )
}

function buildConfig(
  overrides: Partial<Omit<DestructiveOpConfig, 'cascadeImpact' | 'cascadeImpactError'>> = {}
): Omit<DestructiveOpConfig, 'cascadeImpact' | 'cascadeImpactError'> {
  return {
    level: 'WARNING',
    operationId: 'revoke-service-account-credential',
    resourceName: 'Ops SA',
    resourceType: 'credencial de service account',
    onConfirm: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('DestructiveConfirmationDialog + useDestructiveOp composition (#780)', () => {
  it('Scenario A — when the op rejects, surfaces an error and runs NO success side effects', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'))
    const onSuccess = vi.fn()
    render(<Harness config={buildConfig({ onConfirm, onSuccess })} />)

    await user.click(screen.getByRole('button', { name: /open/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    // The op ran exactly once and the failure is surfaced as an inline error. [#743] a
    // network/unknown-status rejection renders the shared localized fallback — never the raw
    // thrown message.
    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(/no se pudo completar la operación/i)
      expect(alert.textContent ?? '').not.toMatch(/boom/i)
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    // No success feedback on failure. (RED on main: the dialog fired config.onSuccess
    // unconditionally, immediately after a no-op `await Promise.resolve(undefined)`.)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('Scenario B — when the op resolves, runs success side effects exactly once (no double reload)', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onSuccess = vi.fn()
    render(<Harness config={buildConfig({ onConfirm, onSuccess })} />)

    await user.click(screen.getByRole('button', { name: /open/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    // Success feedback (the single list reload) fires exactly once — owned by the hook.
    // (RED on main: the dialog also fired config.onSuccess, so it ran twice.)
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
