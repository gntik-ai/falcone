import { useState } from 'react'
import type { SecondFactorType } from '@/services/backupOperationsApi'

interface CriticalConfirmationPanelProps {
  availableSecondFactors: SecondFactorType[]
  onOtpChange: (v: string) => void
  onSecondActorTokenChange: (v: string) => void
  otpValue: string
  secondActorTokenValue: string
}

export function CriticalConfirmationPanel({
  availableSecondFactors,
  onOtpChange,
  onSecondActorTokenChange,
  otpValue,
  secondActorTokenValue,
}: CriticalConfirmationPanelProps) {
  const [tab, setTab] = useState<SecondFactorType>(availableSecondFactors.includes('otp') ? 'otp' : 'second_actor')

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <p className="text-sm font-medium text-red-800">Riesgo crítico: se requiere segundo factor.</p>
      <div className="mt-3 flex gap-2">
        {availableSecondFactors.includes('otp') && (
          <button type="button" className={`rounded px-3 py-1 text-sm ${tab === 'otp' ? 'bg-white shadow' : 'bg-red-100'}`} onClick={() => setTab('otp')}>
            Código MFA (OTP)
          </button>
        )}
        <button type="button" className={`rounded px-3 py-1 text-sm ${tab === 'second_actor' ? 'bg-white shadow' : 'bg-red-100'}`} onClick={() => setTab('second_actor')}>
          Aprobación de segundo administrador
        </button>
      </div>

      {tab === 'otp' && availableSecondFactors.includes('otp') && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-slate-700">Código OTP de 6 dígitos</label>
          <input
            aria-label="OTP code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={otpValue}
            onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      )}

      {tab === 'second_actor' && (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-slate-700">Token JWT del segundo superadmin</label>
          <textarea
            aria-label="Second actor token"
            value={secondActorTokenValue}
            onChange={(e) => onSecondActorTokenChange(e.target.value)}
            rows={4}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
      )}
    </div>
  )
}
