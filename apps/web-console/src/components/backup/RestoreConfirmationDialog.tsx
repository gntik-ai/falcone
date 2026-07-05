import { useEffect, useId, useMemo, useState } from 'react'
import type { InitiateRestoreResponse, ConfirmRestoreBody } from '@/services/backupOperationsApi'
import { RiskLevelBadge } from './RiskLevelBadge'
import { PrecheckResultList } from './PrecheckResultList'
import { TenantNameInput } from './TenantNameInput'
import { CriticalConfirmationPanel } from './CriticalConfirmationPanel'
import { useModalFocusTrap } from '@/components/console/hooks/useModalFocusTrap'
import type { ConfirmRestoreOpts } from '@/hooks/useTriggerRestore'

interface RestoreConfirmationDialogProps {
  precheckResponse: InitiateRestoreResponse
  onConfirm: (opts: ConfirmRestoreOpts) => Promise<void>
  onAbort: () => Promise<void>
  isConfirming: boolean
}

export function RestoreConfirmationDialog({ precheckResponse, onConfirm, onAbort, isConfirming }: RestoreConfirmationDialogProps) {
  const [tenantName, setTenantName] = useState('')
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [secondActorToken, setSecondActorToken] = useState('')
  const hasBlocking = useMemo(() => precheckResponse.prechecks.some((p) => p.result === 'blocking_error'), [precheckResponse.prechecks])
  const tenantMatches = tenantName === precheckResponse.target.tenant_name
  const needsWarningsAck = precheckResponse.risk_level !== 'normal'
  const needsCriticalFactor = precheckResponse.risk_level === 'critical'
  const hasSecondFactor = !needsCriticalFactor || otpCode.length === 6 || secondActorToken.trim().length > 0
  const canConfirm = !hasBlocking && tenantMatches && (!needsWarningsAck || acknowledgeWarnings) && hasSecondFactor
  const titleId = useId()
  const descriptionId = useId()
  // Focus-on-open + Tab-trap + focus-return, matching the sibling DestructiveConfirmationDialog.
  // The dialog is mounted only while active, so it is always "open" here.
  const { panelRef, handleTabTrap } = useModalFocusTrap<HTMLDivElement>(true)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Escape dismisses the dialog (same effect as the Cancelar button) unless a confirmation is
      // already in flight — mirrors DestructiveConfirmationDialog's Escape semantics.
      if (event.key === 'Escape' && !isConfirming) {
        event.preventDefault()
        void onAbort()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isConfirming, onAbort])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onKeyDown={handleTabTrap}
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card p-6 shadow-xl focus:outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-foreground">Confirmar restauración destructiva</h2>
            <p id={descriptionId} className="text-sm text-muted-foreground">Se requiere confirmación reforzada antes de continuar.</p>
          </div>
          <RiskLevelBadge riskLevel={precheckResponse.risk_level} />
        </div>

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Objetivo</h3>
          <p className="text-sm text-foreground">Organización: {precheckResponse.target.tenant_name}</p>
          <p className="text-sm text-foreground">Componente: {precheckResponse.target.component_type}</p>
          <p className="text-sm text-foreground">Instancia: {precheckResponse.target.instance_id}</p>
          <p className="text-sm text-foreground">Instantánea: {precheckResponse.target.snapshot_id}</p>
          <p className="text-sm text-muted-foreground">Creado: {new Date(precheckResponse.target.snapshot_created_at).toLocaleString()} · {precheckResponse.target.snapshot_age_hours} horas</p>
        </section>

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Prechecks</h3>
          <PrecheckResultList prechecks={precheckResponse.prechecks} />
        </section>

        <section className="mt-4 space-y-4">
          <TenantNameInput tenantName={precheckResponse.target.tenant_name} value={tenantName} onChange={setTenantName} />

          {needsWarningsAck && (
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" checked={acknowledgeWarnings} onChange={(e) => setAcknowledgeWarnings(e.target.checked)} />
              <span>He revisado y entiendo las advertencias mostradas</span>
            </label>
          )}

          {needsCriticalFactor && (
            <CriticalConfirmationPanel
              availableSecondFactors={precheckResponse.available_second_factors}
              otpValue={otpCode}
              secondActorTokenValue={secondActorToken}
              onOtpChange={setOtpCode}
              onSecondActorTokenChange={setSecondActorToken}
            />
          )}
        </section>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onAbort} className="rounded border px-4 py-2 text-sm">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canConfirm || isConfirming}
            onClick={() => onConfirm({
              tenant_name_confirmation: tenantName,
              acknowledge_warnings: acknowledgeWarnings,
              second_factor_type: otpCode.length === 6 ? 'otp' : secondActorToken.trim() ? 'second_actor' : undefined,
              otp_code: otpCode.length === 6 ? otpCode : undefined,
              second_actor_token: secondActorToken.trim() || undefined,
            })}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isConfirming ? 'Confirmando…' : 'Confirmar restauración'}
          </button>
        </div>
      </div>
    </div>
  )
}
