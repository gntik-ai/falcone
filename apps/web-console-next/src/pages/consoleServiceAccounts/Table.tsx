import { useTranslation } from 'react-i18next'
import { Button, StatusTag, Text, Timestamp } from '@gntik-ai/ui'
import { DataTable, type DataTableColumn } from '@gntik-ai/blocks'
import { accountName, isRevoked, type ServiceAccount } from './api'
import { focusRing } from './Failure'

export const credentialHelpId = 'service-account-credential-actions-help'
// Legacy formatConsoleEnumLabel: underscores to spaces, first letter upper-cased.
const humanize = (value: string) => { const text = value.replace(/_/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1) }
const CLIENT_TONES = { enabled: 'success', active: 'success', disabled: 'neutral', suspended: 'warning' } as const
const CREDENTIAL_TONES = { active: 'success', rotated: 'info', revoked: 'destructive', expired: 'warning' } as const

export function triggerSelector(kind: string, serviceAccountId: string) { return `[data-credential-trigger="${kind}-${serviceAccountId}"]` }

interface Props {
  rows: ServiceAccount[]
  blocked: boolean
  blockedReason: string
  // `kind:id` of every action in flight, to show its loading state.
  busy: ReadonlySet<string>
  onReveal: (account: ServiceAccount) => void
  onConfirm: (action: 'rotate' | 'revoke' | 'delete', account: ServiceAccount, trigger: HTMLElement) => void
}

export function AccountsTable({ rows, blocked, blockedReason, busy, onReveal, onConfirm }: Props) {
  const { t, i18n } = useTranslation('pages.console-service-accounts-page')
  const statusLabels = Object.fromEntries(['active', 'rotated', 'revoked', 'expired'].map((key) => [key, t(`credentialStatuses.${key}`)]))
  const credentialStatuses = {
    active: { label: statusLabels.active, tone: CREDENTIAL_TONES.active }, rotated: { label: statusLabels.rotated, tone: CREDENTIAL_TONES.rotated },
    revoked: { label: statusLabels.revoked, tone: CREDENTIAL_TONES.revoked }, expired: { label: statusLabels.expired, tone: CREDENTIAL_TONES.expired },
  }
  const known = (prefix: string, value: string) => /^[a-z_]+$/.test(value) && i18n.exists(`${prefix}.${value}`, { ns: 'pages.console-service-accounts-page' })
  const clientLabel = (value: string | null) => !value ? t('clientStates.unavailable') : known('clientStates', value) && value !== 'unavailable' ? t(`clientStates.${value}`) : humanize(value)
  const accessLabel = (value: string | null | undefined) => !value ? t('accessLevels.unknown') : known('accessLevels', value) ? t(`accessLevels.${value}`) : humanize(value)
  const action = (kind: 'reveal' | 'rotate' | 'revoke' | 'delete', account: ServiceAccount, disabled: boolean, title: string, revealOnly?: boolean) => {
    const name = accountName(account)
    return <Button type="button" variant={kind === 'delete' ? 'destructive' : 'secondary'} size="sm" loading={busy.has(`${kind}:${account.serviceAccountId}`)} disabled={disabled} iconOnly={false} icon={undefined} trailingIcon={undefined}
      aria-label={t(`row.${kind}Named`, { name })} aria-describedby={revealOnly ? credentialHelpId : undefined} title={title} data-credential-trigger={`${kind}-${account.serviceAccountId}`} className={focusRing}
      onClick={(event) => { if (kind === 'reveal') onReveal(account); else onConfirm(kind, account, event.currentTarget) }}>{t(`row.${kind}`)}</Button>
  }
  const columns: DataTableColumn<ServiceAccount>[] = [
    { id: 'name', header: t('table.name'), sortable: false, cell: (row) => <Text variant="body" tone="default" className="wrap-anywhere font-medium">{accountName(row)}</Text> },
    { id: 'clientState', header: t('table.clientState'), sortable: false, cell: (row) => {
      const value = row.accessProjection?.clientState ?? row.desiredState ?? null
      const label = clientLabel(value)
      return <StatusTag status={value ?? 'unavailable'} label={label} statuses={{ [value ?? 'unavailable']: { label, tone: (CLIENT_TONES as Record<string, 'success' | 'neutral' | 'warning'>)[value ?? ''] ?? 'neutral' } }} uppercase={false} />
    } },
    { id: 'credential', header: t('table.credential'), sortable: false, cell: (row) => {
      const state = row.credentialStatus?.state
      // Unknown non-empty values keep their raw text and a neutral tone; only a missing value is "unknown".
      const label = !state ? t('credentialStatuses.unknown') : state in credentialStatuses ? statusLabels[state] : state
      return <div className="space-y-1.5">
        <StatusTag status={state || 'unknown'} label={label} statuses={{ ...credentialStatuses, [state || 'unknown']: credentialStatuses[state as keyof typeof credentialStatuses] ?? { label, tone: 'neutral' } }} uppercase={false} />
        {isRevoked(row) && <Text as="p" variant="supporting" tone="muted">{t('table.revokedCaption')}</Text>}
      </div>
    } },
    { id: 'access', header: t('table.access'), sortable: false, cell: (row) => accessLabel(row.accessProjection?.effectiveAccess) },
    { id: 'expires', header: t('table.expires'), sortable: false, cell: (row) => {
      if (!row.expiresAt) return t('table.missing')
      return Number.isNaN(Date.parse(row.expiresAt)) ? row.expiresAt
        : <Timestamp value={row.expiresAt} locale={i18n.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} live={false} tooltip={false} fallback={t('table.missing')} />
    } },
    { id: 'actions', header: t('table.actions'), sortable: false, cell: (row) => {
      const revoked = isRevoked(row)
      return <div className="flex flex-wrap justify-end gap-2">
        {action('reveal', row, blocked || revoked, blocked ? blockedReason : revoked ? t('row.revealRevoked') : t('row.revealHint'), true)}
        {action('rotate', row, blocked || revoked, blocked ? blockedReason : revoked ? t('row.rotateRevoked') : t('row.rotateHint'), true)}
        {action('revoke', row, blocked, blocked ? blockedReason : '')}
        {action('delete', row, blocked, blocked ? blockedReason : '')}
      </div>
    } },
  ]
  return <DataTable rows={rows} columns={columns} getRowId={(row) => row.serviceAccountId} getRowLabel={(row) => accountName(row)} caption={t('table.caption')} showCaption={false} paginated={false}
    selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null}
    showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="service-accounts-table min-w-0"
    labels={{ scrollRegion: t('table.caption'), emptyTitle: t('states.empty'), emptyDescription: t('states.emptyDescription'), loading: () => t('states.loading') }} />
}
