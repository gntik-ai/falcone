import { useMemo, useState } from 'react'
import type { InitiateRestoreResponse, ConfirmRestoreBody } from '@/services/backupOperationsApi'
import { RiskLevelBadge } from './RiskLevelBadge'
import { PrecheckResultList } from './PrecheckResultList'
import { TenantNameInput } from './TenantNameInput'
import { CriticalConfirmationPanel } from './CriticalConfirmationPanel'
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

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Confirmar restauración destructiva</h2>
            <p className="text-sm text-slate-600">Se requiere confirmación reforzada antes de continuar.</p>
          </div>
          <RiskLevelBadge riskLevel={precheckResponse.risk_level} />
        </div>

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">Objetivo</h3>
          <p className="text-sm text-slate-700">Tenant: {precheckResponse.target.tenant_name}</p>
          <p className="text-sm text-slate-700">Componente: {precheckResponse.target.component_type}</p>
          <p className="text-sm text-slate-700">Instancia: {precheckResponse.target.instance_id}</p>
          <p className="text-sm text-slate-700">Snapshot: {precheckResponse.target.snapshot_id}</p>
          <p className="text-sm text-slate-500">Creado: {new Date(precheckResponse.target.snapshot_created_at).toLocaleString()} · {precheckResponse.target.snapshot_age_hours} horas</p>
        </section>

        <section className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold">Prechecks</h3>
          <PrecheckResultList prechecks={precheckResponse.prechecks} />
        </section>

        <section className="mt-4 space-y-4">
          <TenantNameInput tenantName={precheckResponse.target.tenant_name} value={tenantName} onChange={setTenantName} />

          {needsWarningsAck && (
            <label className="flex items-start gap-2 text-sm text-slate-700">
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
