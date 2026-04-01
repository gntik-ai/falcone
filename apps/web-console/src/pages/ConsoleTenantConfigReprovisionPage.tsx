import { useState, useCallback } from 'react'
import { ConfigIdentifierMapEditor } from '@/components/ConfigIdentifierMapEditor'
import { ConfigReprovisionResultPanel } from '@/components/ConfigReprovisionResultPanel'
import {
  reprovisionTenantConfig,
  generateIdentifierMap,
  ConfigReprovisionApiError,
} from '@/api/configReprovisionApi'
import type { IdentifierMapEntry, IdentifierMap, ReprovisionResult } from '@/api/configReprovisionApi'

type Step = 'upload' | 'map' | 'configure' | 'result'

interface PageProps {
  tenantId: string
  userRole?: string
}

const KNOWN_DOMAINS = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']

export function ConsoleTenantConfigReprovisionPage({ tenantId, userRole }: PageProps) {
  const [step, setStep] = useState<Step>('upload')
  const [artifactText, setArtifactText] = useState('')
  const [artifact, setArtifact] = useState<Record<string, unknown> | null>(null)
  const [mapEntries, setMapEntries] = useState<IdentifierMapEntry[]>([])
  const [mapWarnings, setMapWarnings] = useState<string[]>([])
  const [selectedDomains, setSelectedDomains] = useState<string[]>([])
  const [dryRun, setDryRun] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [result, setResult] = useState<ReprovisionResult | null>(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  // Access control
  if (userRole && !['superadmin', 'sre'].includes(userRole)) {
    return (
      <div data-testid="forbidden" className="p-8 text-center text-red-600">
        No tienes permisos para acceder a esta página.
      </div>
    )
  }

  const handleAnalyzeArtifact = useCallback(async () => {
    setError(undefined)
    setLoading(true)
    try {
      const parsed = JSON.parse(artifactText)
      setArtifact(parsed)

      const response = await generateIdentifierMap(tenantId, parsed)
      setMapEntries(response.proposal.entries ?? [])
      setMapWarnings(response.warnings ?? [])
      setStep('map')
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('El artefacto no es un JSON válido.')
      } else if (err instanceof ConfigReprovisionApiError) {
        setError(err.message)
      } else {
        setError('Error al analizar el artefacto.')
      }
    } finally {
      setLoading(false)
    }
  }, [artifactText, tenantId])

  const handleConfirmMap = useCallback(() => {
    setStep('configure')
  }, [])

  const handleExecute = useCallback(async () => {
    if (!dryRun) {
      setShowConfirmModal(true)
      return
    }
    await _executeReprovision()
  }, [dryRun])

  const _executeReprovision = useCallback(async () => {
    setShowConfirmModal(false)
    setError(undefined)
    setLoading(true)
    try {
      const identifierMap: IdentifierMap | undefined = mapEntries.length > 0
        ? { entries: mapEntries }
        : undefined

      const res = await reprovisionTenantConfig(tenantId, {
        artifact: artifact!,
        identifier_map: identifierMap,
        domains: selectedDomains.length > 0 ? selectedDomains : undefined,
        dry_run: dryRun,
      })

      setResult(res)
      setStep('result')
    } catch (err) {
      if (err instanceof ConfigReprovisionApiError) {
        setError(err.message)
      } else {
        setError('Error al ejecutar el reaprovisionamiento.')
      }
    } finally {
      setLoading(false)
    }
  }, [artifact, mapEntries, selectedDomains, dryRun, tenantId])

  const handleReset = useCallback(() => {
    setStep('upload')
    setArtifactText('')
    setArtifact(null)
    setMapEntries([])
    setMapWarnings([])
    setSelectedDomains([])
    setDryRun(true)
    setResult(null)
    setError(undefined)
  }, [])

  const handleDomainToggle = useCallback((domain: string) => {
    setSelectedDomains(prev =>
      prev.includes(domain) ? prev.filter(d => d !== domain) : [...prev, domain]
    )
  }, [])

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6" data-testid="reprovision-page">
      <h1 className="text-xl font-bold text-slate-800">Reaprovisionamiento de configuración</h1>
      <p className="text-sm text-slate-500">Tenant destino: <span className="font-mono font-medium">{tenantId}</span></p>

      {error && (
        <div data-testid="page-error" className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Step 1: Upload artifact */}
      {step === 'upload' && (
        <div className="space-y-3" data-testid="step-upload">
          <h2 className="text-sm font-semibold text-slate-700">Paso 1 — Cargar artefacto de exportación</h2>
          <textarea
            className="w-full h-48 rounded-md border border-slate-300 p-3 font-mono text-xs focus:ring-blue-500 focus:outline-none focus:ring-1"
            placeholder="Pega aquí el JSON del artefacto de exportación…"
            value={artifactText}
            onChange={(e) => setArtifactText(e.target.value)}
            aria-label="Artefacto de exportación JSON"
            data-testid="artifact-input"
          />
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            onClick={handleAnalyzeArtifact}
            disabled={loading || !artifactText.trim()}
            data-testid="analyze-button"
          >
            {loading ? 'Analizando…' : 'Analizar artefacto'}
          </button>
        </div>
      )}

      {/* Step 2: Review identifier map */}
      {step === 'map' && (
        <div className="space-y-3" data-testid="step-map">
          <h2 className="text-sm font-semibold text-slate-700">Paso 2 — Revisar mapa de identificadores</h2>
          {mapWarnings.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
              <ul>{mapWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>
            </div>
          )}
          <ConfigIdentifierMapEditor entries={mapEntries} onChange={setMapEntries} />
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={handleConfirmMap}
            data-testid="confirm-map-button"
          >
            Confirmar mapa
          </button>
        </div>
      )}

      {/* Step 3: Configure and execute */}
      {step === 'configure' && (
        <div className="space-y-4" data-testid="step-configure">
          <h2 className="text-sm font-semibold text-slate-700">Paso 3 — Configurar y ejecutar</h2>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="dry-run-toggle"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="rounded"
              data-testid="dry-run-toggle"
            />
            <label htmlFor="dry-run-toggle" className="text-sm text-slate-700">
              Modo simulación (dry run)
            </label>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Filtrar dominios (opcional):</p>
            <div className="flex flex-wrap gap-2">
              {KNOWN_DOMAINS.map(d => (
                <label key={d} className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={selectedDomains.includes(d)}
                    onChange={() => handleDomainToggle(d)}
                    className="rounded"
                    data-testid={`domain-filter-${d}`}
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>

          <button
            type="button"
            className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
              dryRun ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'
            } disabled:opacity-50`}
            onClick={handleExecute}
            disabled={loading}
            data-testid="execute-button"
          >
            {loading ? 'Procesando…' : dryRun ? 'Ejecutar simulación' : 'Aplicar configuración'}
          </button>
        </div>
      )}

      {/* Step 4: Result */}
      {step === 'result' && (
        <div className="space-y-3" data-testid="step-result">
          <h2 className="text-sm font-semibold text-slate-700">Paso 4 — Resultado</h2>
          <ConfigReprovisionResultPanel result={result} loading={loading} error={error} />
          <button
            type="button"
            className="rounded-md bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            onClick={handleReset}
            data-testid="reset-button"
          >
            Nueva operación
          </button>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="confirm-modal">
          <div className="bg-white rounded-lg p-6 max-w-md shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-red-700">⚠ Confirmar aplicación</h3>
            <p className="text-sm text-slate-600">
              Esta acción aplicará cambios reales en la configuración del tenant <span className="font-mono font-bold">{tenantId}</span>.
              Los cambios no se pueden deshacer automáticamente.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                className="rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
                onClick={() => setShowConfirmModal(false)}
                data-testid="cancel-confirm"
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                onClick={_executeReprovision}
                data-testid="confirm-apply"
              >
                Confirmar y aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
