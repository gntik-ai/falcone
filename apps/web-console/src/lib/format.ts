// Shared console formatting helpers (#766).
//
// `formatBytes` was previously duplicated, near-identically, in `ConsoleStoragePage.tsx` and
// `ConsoleMongoPage.tsx`. Both implementations produced byte-identical output for every value
// either page actually renders (verified against both pages' existing vitest assertions —
// `2.0 KB` / `4.0 KB` / `8.0 KB / 16 KB`), so this is a pure lift: both call sites now import
// this single implementation instead of shipping their own copy.
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/**
 * Humanizes a byte count into a compact, human-readable string (e.g. `8.0 KB`, `5.0 GB`).
 * Division is base-1024 — the same convention the two lifted implementations used — so the
 * unit boundaries match `KiB`/`MiB`/`GiB` magnitudes even though the labels keep the console's
 * existing `KB`/`MB`/`GB` short form.
 */
export function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`

  let value = bytes / 1024
  let unitIndex = 1
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[unitIndex]}`
}

/**
 * The quota/metric dimension wire contract carries a `unit` field of `'count' | 'bytes'` (see
 * `services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql`'s
 * `quota_dimension_catalog.unit CHECK (unit IN ('count', 'bytes'))`, and the
 * `QuotaDimensionPosture`/usage-view OpenAPI schemas, both of which the "real" control-plane
 * API populates). Some deploy runtimes omit `unit` from the response entirely, so fall back to
 * the `dimensionId` naming convention observed in the same catalog (`max_storage_bytes`,
 * `storage_volume_bytes`, ...): a `_bytes`/`.bytes` suffix.
 *
 * CRITICAL: this must stay conservative. A `count` dimension (API keys, requests, workspaces,
 * ...) must NEVER be run through `formatBytes` — only an explicit `unit: 'bytes'` or a
 * `*_bytes`/`*.bytes` dimensionId opts in.
 */
export function isByteUnitDimension(unit?: string | null, dimensionId?: string | null): boolean {
  if (unit === 'bytes') return true
  if (unit) return false
  return /(?:^|[._])bytes$/i.test(dimensionId ?? '')
}

/**
 * Renders a quota/metric dimension value: humanized bytes for a byte-unit dimension, a plain
 * integer for anything else (counts must never be GiB-ified).
 */
export function formatDimensionValue(value: number, unit?: string | null, dimensionId?: string | null): string {
  return isByteUnitDimension(unit, dimensionId) ? formatBytes(value) : String(value)
}
