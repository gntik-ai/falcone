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
import { describeConsoleError } from '@/lib/console-errors'

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
          setError('No tienes permisos para exportar configuración de esta organización.')
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
            setError(`Organización '${tenantId}' no encontrada.`)
            break
          case 422:
            setError('El artefacto de exportación es demasiado grande. Prueba seleccionando menos dominios.')
            break
          case 429:
            setError('Demasiadas solicitudes. Espera un momento e intenta de nuevo.')
            break
          default:
            // The four cases above are console-owned copy for a narrow, known allow-list of
            // status codes (#743's proposal note). Anything else must never echo the raw
            // transport message — map by the real status (ConfigExportApiError carries it as
            // `statusCode`, not `status`).
            setError(describeConsoleError({ status: err.statusCode, code: err.code, message: err.message }, 'Error inesperado durante la exportación.'))
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
    <div className="space-y-6" data-testid="config-export-page">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Exportación de Configuración Funcional</h1>
        <p className="text-sm text-muted-foreground">
          Selecciona los dominios a exportar y genera un artefacto JSON con la configuración de la organización.
        </p>
      </div>

      {error && !artifact && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive" data-testid="page-error">
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
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        data-testid="export-btn"
      >
        {isLoading ? 'Exportando…' : 'Exportar configuración'}
      </button>

      {partialWarning && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300" data-testid="partial-warning">
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
