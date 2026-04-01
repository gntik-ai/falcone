/**
 * ConfigArtifactValidator — Panel for validating and migrating config export artifacts.
 *
 * Local state only (no Redux). Artifact JSON never leaves the browser
 * without explicit user action.
 */

import { useState, useCallback } from 'react'
import {
  validateArtifact,
  migrateArtifact,
  type ValidationResult,
  type MigrationResult,
  ConfigSchemaApiError,
} from '../api/configSchemaApi'

interface Props {
  tenantId: string
}

type Phase = 'idle' | 'validating' | 'validated' | 'migrating' | 'migrated' | 'error'

export default function ConfigArtifactValidator({ tenantId }: Props) {
  const [rawJson, setRawJson] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [migration, setMigration] = useState<MigrationResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const detectedVersion = (() => {
    try {
      const parsed = JSON.parse(rawJson)
      return parsed?.format_version ?? null
    } catch {
      return null
    }
  })()

  const handleValidate = useCallback(async () => {
    setPhase('validating')
    setValidation(null)
    setMigration(null)
    setErrorMessage(null)

    try {
      const artifact = JSON.parse(rawJson)
      const result = await validateArtifact(tenantId, artifact)
      setValidation(result)
      setPhase('validated')
    } catch (err) {
      if (err instanceof ConfigSchemaApiError) {
        setErrorMessage(`${err.statusCode}: ${err.message}`)
      } else if (err instanceof SyntaxError) {
        setErrorMessage('Invalid JSON')
      } else {
        setErrorMessage(String(err))
      }
      setPhase('error')
    }
  }, [rawJson, tenantId])

  const handleMigrate = useCallback(async () => {
    setPhase('migrating')
    setMigration(null)
    setErrorMessage(null)

    try {
      const artifact = JSON.parse(rawJson)
      const result = await migrateArtifact(tenantId, artifact)
      setMigration(result)
      setPhase('migrated')
    } catch (err) {
      if (err instanceof ConfigSchemaApiError) {
        setErrorMessage(`${err.statusCode}: ${err.message}`)
      } else {
        setErrorMessage(String(err))
      }
      setPhase('error')
    }
  }, [rawJson, tenantId])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRawJson(reader.result as string)
    reader.readAsText(file)
  }, [])

  const handleDownloadMigrated = useCallback(() => {
    if (!migration?.artifact) return
    const blob = new Blob([JSON.stringify(migration.artifact, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `migrated-config-${tenantId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [migration, tenantId])

  const resultBadgeClass = (result: string) => {
    switch (result) {
      case 'valid': return 'bg-green-100 text-green-800 border-green-300'
      case 'invalid': return 'bg-red-100 text-red-800 border-red-300'
      case 'valid_with_warnings': return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      default: return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Config Artifact Validator</h2>

      {/* Input area */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Paste artifact JSON or upload a file:
        </label>
        <textarea
          className="w-full h-48 font-mono text-sm border rounded p-2"
          value={rawJson}
          onChange={e => setRawJson(e.target.value)}
          placeholder='{"format_version": "1.0.0", ...}'
        />
        <input type="file" accept=".json" onChange={handleFileUpload} className="text-sm" />
      </div>

      {/* Detected version */}
      {detectedVersion && (
        <p className="text-sm text-gray-600">
          Detected <code>format_version</code>: <strong>{detectedVersion}</strong>
        </p>
      )}

      {/* Validate button */}
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        onClick={handleValidate}
        disabled={!rawJson.trim() || phase === 'validating'}
      >
        {phase === 'validating' ? 'Validating…' : 'Validate Artifact'}
      </button>

      {/* Error */}
      {errorMessage && (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3 text-sm">
          {errorMessage}
        </div>
      )}

      {/* Validation result */}
      {validation && (
        <div className="border rounded p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 text-xs font-semibold rounded border ${resultBadgeClass(validation.result)}`}>
              {validation.result}
            </span>
            <span className="text-sm text-gray-500">Format: {validation.format_version}</span>
          </div>

          {validation.schema_checksum_match !== null && (
            <p className="text-sm">
              Schema checksum: {validation.schema_checksum_match ? '✅ match' : '⚠️ mismatch'}
            </p>
          )}

          {validation.errors.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-red-700">Errors ({validation.errors.length})</h4>
              <ul className="list-disc list-inside text-sm text-red-600">
                {validation.errors.map((e, i) => (
                  <li key={i}><code>{e.path}</code>: {e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-yellow-700">Warnings ({validation.warnings.length})</h4>
              <ul className="list-disc list-inside text-sm text-yellow-600">
                {validation.warnings.map((w, i) => (
                  <li key={i}><code>{w.path}</code>: {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {validation.migration_required && (
            <div className="border-t pt-3">
              <p className="text-sm text-orange-700 font-medium">
                ⚠️ Migration required — artifact major version differs from platform.
              </p>
              <button
                className="mt-2 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                onClick={handleMigrate}
                disabled={phase === 'migrating'}
              >
                {phase === 'migrating' ? 'Migrating…' : 'Migrate Artifact'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Migration result */}
      {migration && migration.migration_required && (
        <div className="border border-green-300 bg-green-50 rounded p-4 space-y-3">
          <h3 className="text-sm font-semibold text-green-800">Migration Complete</h3>

          {migration._migration_metadata && (
            <p className="text-sm">
              {migration._migration_metadata.migrated_from} → {migration._migration_metadata.migrated_to}
              {' '}via chain: {migration._migration_metadata.migration_chain.join(' → ')}
            </p>
          )}

          {migration._migration_warnings && migration._migration_warnings.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-yellow-700">Migration Warnings</h4>
              <ul className="list-disc list-inside text-sm text-yellow-600">
                {migration._migration_warnings.map((w, i) => (
                  <li key={i}>[{w.step}] {w.message}{w.affected_path ? ` (${w.affected_path})` : ''}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            onClick={handleDownloadMigrated}
          >
            Download Migrated Artifact
          </button>
        </div>
      )}
    </div>
  )
}
