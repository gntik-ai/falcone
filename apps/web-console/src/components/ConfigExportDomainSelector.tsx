import type { DomainAvailability } from '@/api/configExportApi'

interface ConfigExportDomainSelectorProps {
  domains: DomainAvailability[]
  selectedDomains: string[]
  onChange: (domains: string[]) => void
  disabled?: boolean
}

export function ConfigExportDomainSelector({
  domains,
  selectedDomains,
  onChange,
  disabled = false,
}: ConfigExportDomainSelectorProps) {
  const availableDomains = domains.filter(d => d.availability === 'available')

  function handleToggle(domainKey: string, checked: boolean) {
    if (checked) {
      onChange([...selectedDomains, domainKey])
    } else {
      onChange(selectedDomains.filter(k => k !== domainKey))
    }
  }

  function handleSelectAll() {
    onChange(availableDomains.map(d => d.domain_key))
  }

  return (
    <div data-testid="domain-selector" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-700">Dominios a exportar</h3>
        <button
          type="button"
          onClick={handleSelectAll}
          disabled={disabled}
          className="text-xs text-blue-600 hover:text-blue-800 disabled:text-slate-400"
          data-testid="select-all-btn"
        >
          Seleccionar todos los disponibles
        </button>
      </div>
      <ul className="space-y-2" role="group" aria-label="Selección de dominios">
        {domains.map(domain => {
          const isAvailable = domain.availability === 'available'
          const isChecked = selectedDomains.includes(domain.domain_key)

          return (
            <li key={domain.domain_key} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`domain-${domain.domain_key}`}
                checked={isChecked}
                disabled={disabled || !isAvailable}
                onChange={e => handleToggle(domain.domain_key, e.target.checked)}
                className="rounded border-slate-300"
                aria-label={domain.description}
                data-testid={`domain-check-${domain.domain_key}`}
              />
              <label
                htmlFor={`domain-${domain.domain_key}`}
                className={`text-sm ${isAvailable ? 'text-slate-700' : 'text-slate-400'}`}
              >
                {domain.description}
                {!isAvailable && domain.reason && (
                  <span
                    className="ml-1 text-xs text-slate-400"
                    title={domain.reason}
                    data-testid={`domain-reason-${domain.domain_key}`}
                  >
                    ({domain.reason})
                  </span>
                )}
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
