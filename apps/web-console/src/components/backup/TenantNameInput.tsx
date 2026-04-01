import { useEffect } from 'react'

interface TenantNameInputProps {
  tenantName?: string
  expectedName?: string
  value: string
  onChange: (v: string) => void
  onMatch?: (isMatch: boolean) => void
  disabled?: boolean
}

export function TenantNameInput({ tenantName, expectedName, value, onChange, onMatch, disabled }: TenantNameInputProps) {
  const expected = tenantName ?? expectedName ?? ''
  const isMatch = expected.length > 0 && value === expected

  useEffect(() => {
    onMatch?.(isMatch)
  }, [isMatch, onMatch])

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700">
        Escribe el nombre exacto del tenant para confirmar
      </label>
      <div className="flex items-center gap-2">
        <input
          aria-label="Tenant name confirmation"
          placeholder="Escribe el nombre del tenant para confirmar"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {isMatch ? <span aria-label="Coincide" className="text-green-600">✅</span> : <span aria-label="No coincide" className="text-slate-400">❌</span>}
      </div>
    </div>
  )
}
