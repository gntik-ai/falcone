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
      <label className="block text-sm font-medium text-foreground">
        Escribe el nombre exacto de la organización para confirmar
      </label>
      <div className="flex items-center gap-2">
        <input
          aria-label="Confirmación del nombre de la organización"
          placeholder="Escribe el nombre de la organización para confirmar"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
        {isMatch ? <span aria-label="Coincide" className="text-emerald-400">✅</span> : <span aria-label="No coincide" className="text-muted-foreground">❌</span>}
      </div>
    </div>
  )
}
