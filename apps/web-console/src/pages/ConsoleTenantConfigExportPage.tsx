import { useState, useEffect } from 'react'

import {
  getExportableDomains,
  exportTenantConfig,
  ConfigExportApiError,
  type ExportArtifact,
  type DomainAvailability,
} from '@/api/configExportApi'
import { ConfigExportDomainSelector } from '@/components/ConfigExportDomainSelector'
import { ConfigExportResultPanel } from '@/components/ConfigExportResultPanel'

interface ConsoleTenantConfigExportPageProps {
  tenantId?: string
}

export default function ConsoleTenantConfigExportPage({ tenantId = 'default' }: ConsoleTenantConfigExportPageProps) {
  const [domains, setDomains] = useState<DomainAvailability[]>([])
  const [selectedDomains, setSelectedDomains] = useState<string[]>([])
  const [artifact, setArtifact] = useState<ExportArtifact | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingDomains, setIsLoadingDomains] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [partialWarning, setPartialWarning] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoadingDomains(true)
    getExportableDomains(tenantId)
      .then(res => {
        if (cancelled) return
        setDomains(res.domains)
        setSelectedDomains(res.domains.filter(d => d.availability === 'available').map(d => d.domain_key))
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ConfigExportApiError && err.statusCode === 403) {
          setError('No tienes permisos para exportar configuración de este tenant.')
        } else {
          setError('Error al obtener dominios exportables.')
        }
      })
      .finally(() => { if (!cancelled) setIsLoadingDomains(false) })
    return () => { cancelled = true }
  }, [tenantId])

  async function handleExport() {
    setIsLoading(true)
    setError(undefined)
    setArtifact(null)
    setPartialWarning(false)

    try {
      const domainsParam = selectedDomains.length > 0 ? selectedDomains : undefined
      const result = await exportTenantConfig(tenantId, { domains: domainsParam })
      setArtifact(result.artifact)
      if (result.status === 207) setPartialWarning(true)
    } catch (err) {
      if (err instanceof ConfigExportApiError) {
        switch (err.statusCode) {
          case 403:
            setError('Permiso denegado: no tienes el rol necesario para esta operación.')
            break
          case 404:
            setError(`Tenant '${tenantId}' no encontrado.`)
            break
          case 422:
            setError('El artefacto de exportación es demasiado grande. Prueba seleccionando menos dominios.')
            break
          case 429:
            setError('Demasiadas solicitudes. Espera un momento e intenta de nuevo.')
            break
          default:
            setError(err.message)
        }
      } else {
        setError('Error inesperado durante la exportación.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoadingDomains) {
    return <div className="animate-pulse p-6" data-testid="domains-loading">Cargando dominios exportables…</div>
  }

  return (
    <div className="space-y-6 p-6" data-testid="config-export-page">
      <div>
        <h1 className="text-2xl font-bold">Exportación de Configuración Funcional</h1>
        <p className="text-sm text-slate-600">
          Selecciona los dominios a exportar y genera un artefacto JSON con la configuración del tenant.
        </p>
      </div>

      {error && !artifact && (
        <div className="rounded-md bg-red-50 p-4 text-red-700" data-testid="page-error">
          {error}
        </div>
      )}

      <ConfigExportDomainSelector
        domains={domains}
        selectedDomains={selectedDomains}
        onChange={setSelectedDomains}
        disabled={isLoading}
      />

      <button
        type="button"
        onClick={handleExport}
        disabled={isLoading || selectedDomains.length === 0}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
        data-testid="export-btn"
      >
        {isLoading ? 'Exportando…' : 'Exportar configuración'}
      </button>

      {partialWarning && (
        <div className="rounded-md bg-amber-50 p-4 text-amber-700" data-testid="partial-warning">
          La exportación se completó parcialmente. Algunos dominios presentaron errores.
        </div>
      )}

      <ConfigExportResultPanel
        artifact={artifact}
        isLoading={isLoading}
        error={artifact ? undefined : error}
      />
    </div>
  )
}
