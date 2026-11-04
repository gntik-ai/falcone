import { useRef, type ChangeEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, NumberInput, StatusTag, Text } from '@gntik-ai/ui'
import { DataTable, type DataTableColumn } from '@gntik-ai/blocks'
import type { LimitRow } from './api'
import { validateLimit } from './model'

const NAMESPACE = 'pages.console-plan-detail-page'
// Row outcome of the last mutation on that row; the validity and dirtiness of the draft are derived.
export type RowOutcome = 'saved' | 'failed' | 'reset' | 'resetFailed'
const safeId = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, '-')
// The number field keeps its last parsed number while the text is incomplete ("-") or malformed ("1-"), so the visible text decides.
const wellFormed = /^[-\u2212]?[\d.,\s\u00a0]*\d[\d.,\s\u00a0]*$/
const textState = (text: string): 'empty' | 'ok' | 'malformed' => text.trim() === '' ? 'empty' : wellFormed.test(text.trim()) ? 'ok' : 'malformed'
const tones = { persisted: 'neutral', dirty: 'warning', invalid: 'destructive', saving: 'warning', resetting: 'warning', saved: 'success', reset: 'success', failed: 'destructive', resetFailed: 'destructive' } as const
type RowState = keyof typeof tones

export function LimitsTable({ rows, editable, drafts, versions, outcomes, busyKey, locked, onDraft, onRestore, onSave, onReset }: {
  rows: LimitRow[]
  editable: boolean
  drafts: Record<string, number | null>
  // Bumped whenever a row returns to its persisted value: the number field keeps typed text while focused, so it remounts.
  versions: Record<string, number | undefined>
  outcomes: Record<string, RowOutcome | undefined>
  busyKey: { key: string; reset: boolean } | null
  // Every mutation control is off while any plan action runs or after a backend 403.
  locked: boolean
  onDraft: (key: string, value: number | null) => void
  onRestore: (key: string) => void
  onSave: (key: string) => void
  onReset: (row: LimitRow) => void
}) {
  const { t } = useTranslation(NAMESPACE)
  // Rows whose visible text is not a number, and the last number the field parsed (what it keeps showing while the text is garbled).
  const garbled = useRef<Record<string, boolean>>({})
  const lastParsed = useRef<Record<string, number | null>>({})
  const stateOf = (row: LimitRow): RowState => {
    const key = row.dimensionKey
    if (busyKey?.key === key) return busyKey.reset ? 'resetting' : 'saving'
    if (key in drafts) {
      if (!validateLimit(drafts[key]).valid) return 'invalid'
      if (drafts[key] !== row.effectiveValue) return 'dirty'
    }
    return outcomes[key] ?? 'persisted'
  }
  const statuses = Object.fromEntries((Object.keys(tones) as RowState[]).map((state) => [state, { label: t(`limits.row${state[0].toUpperCase()}${state.slice(1)}`), tone: tones[state] }]))
  const columns: DataTableColumn<LimitRow>[] = [
    { id: 'dimension', header: t('limits.dimension'), sortable: false, cell: (row) => <span className="font-medium break-words">{row.displayLabel}</span> },
    { id: 'value', header: t('limits.value'), sortable: false, align: 'right', cell: (row) => {
      const key = row.dimensionKey
      const id = safeId(key)
      if (!editable) return <span className="tabular-nums">{row.effectiveValue === -1 ? t('limits.unlimited') : String(row.effectiveValue)}</span>
      const draft = key in drafts ? drafts[key] : row.effectiveValue
      const validation = validateLimit(draft)
      const shown = key in drafts && garbled.current[key] && key in lastParsed.current ? lastParsed.current[key] : draft
      const onTextChange = (event: ChangeEvent<HTMLElement>) => {
        const text = (event.target as HTMLInputElement).value ?? ''
        const state = textState(text)
        garbled.current[key] = state === 'malformed'
        // No digit at all reads as empty (required, as the legacy number input does); other malformed text is invalid.
        if (state === 'malformed') onDraft(key, /\d/.test(text) ? Number.NaN : null)
      }
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onRestore(key)
        else if (event.key === 'Enter') { event.preventDefault(); onSave(key) }
      }
      return <div className="ml-auto w-36 min-w-0 text-left" onKeyDown={onKeyDown} onChange={onTextChange}>
        <NumberInput key={versions[key] ?? 0} value={shown} step={1} size="md" align="end" id={`limit-${id}`} disabled={locked} invalid={!validation.valid}
          aria-label={t('limits.inputName', { dimension: row.displayLabel })} aria-describedby={validation.valid ? `limit-${id}-help` : `limit-${id}-help limit-${id}-error`}
          decrementLabel={t('limits.decrease', { dimension: row.displayLabel })} incrementLabel={t('limits.increase', { dimension: row.displayLabel })}
          onValueChange={(value) => { const next = typeof value === 'number' && Number.isFinite(value) ? value : null; lastParsed.current[key] = next; onDraft(key, next) }} />
        <span id={`limit-${id}-help`} className="sr-only">{t('limits.inputHelp')}</span>
        {!validation.valid && <Text id={`limit-${id}-error`} variant="supporting" tone="destructive" role="alert">{t(`limits.${validation.message === 'limitRequired' ? 'required' : 'invalid'}`)}</Text>}
      </div>
    } },
    { id: 'state', header: t('limits.state'), sortable: false, cell: (row) => {
      const state = stateOf(row)
      return <span aria-busy={busyKey?.key === row.dimensionKey} role={state === 'failed' || state === 'resetFailed' ? 'alert' : 'status'}>
        <StatusTag status={state} label={statuses[state].label} statuses={statuses} uppercase={false} />
      </span>
    } },
    { id: 'source', header: t('limits.source'), sortable: false, cell: (row) => t(`limits.source_${row.source}`, { defaultValue: String(row.source).replace(/_/g, ' ') }) },
    { id: 'unit', header: t('limits.unit'), sortable: false, cell: (row) => row.unit ?? t('limits.unitCount') },
    { id: 'actions', header: t('limits.actions'), sortable: false, align: 'right', cell: (row) => {
      if (!editable) return null
      const key = row.dimensionKey
      const busy = busyKey?.key === key
      const draft = key in drafts ? drafts[key] : row.effectiveValue
      const validation = validateLimit(draft)
      const canSave = !locked && validation.valid && draft !== row.effectiveValue
      return <div className="flex flex-wrap justify-end gap-2">
        {/* aria-disabled keeps keyboard focus on Guardar after a successful save, when the row is no longer dirty. */}
        <Button type="button" variant="primary" size="sm" data-save-key={key} aria-disabled={!canSave} aria-busy={busy && !busyKey?.reset}
          aria-label={t('limits.saveName', { dimension: row.displayLabel })} onClick={() => { if (canSave) onSave(key) }}>
          {t(busy && !busyKey?.reset ? 'limits.saving' : 'limits.save')}
        </Button>
        <Button type="button" variant="secondary" size="sm" data-reset-key={key} disabled={locked} aria-busy={busy && Boolean(busyKey?.reset)}
          aria-label={t('limits.resetName', { dimension: row.displayLabel })} onClick={() => onReset(row)}>{t('limits.reset')}</Button>
      </div>
    } },
  ]
  return <div className="min-w-0 max-w-full">
    <DataTable rows={rows} columns={columns} getRowId={(row) => row.dimensionKey} getRowLabel={(row) => row.displayLabel} caption={t('limits.caption')} showCaption={true}
      paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
      sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
      resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('limits.caption'), emptyTitle: t('limits.emptyTitle'), emptyDescription: '', loading: () => t('load.loading') }} />
  </div>
}
