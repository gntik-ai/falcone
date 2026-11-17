import type { TFunction } from 'i18next'
import { CodeBlock, CopyButton, JsonViewer, Text } from '@gntik-ai/ui'
import { DescriptionListCard, SectionHeader, StatusTimeline, type DescriptionItem } from '@gntik-ai/blocks'
import type { FunctionAction, FunctionVersion } from './api'
import { focusRing, formatEnumLabel, formatValue, statusLabel, useCopy } from './copy'
import { functionSnippets } from './snippets'
import { FailurePanel, Loading, SectionFailure, statusTone } from './States'
import type { Fn } from './useFunctions'

type Tone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral'
const dotTone = (value?: string | null): Tone => {
  const tone = statusTone(value)
  return tone === 'primary' ? 'info' : tone === 'success' || tone === 'warning' || tone === 'destructive' ? tone : 'neutral'
}

function card(t: TFunction, id: string, title: string, items: { id: string; label: string; value: unknown; mono?: boolean }[]) {
  const rows: DescriptionItem[] = items.map((item) => ({ id: item.id, label: item.label, value: formatValue(t, item.value), render: undefined, status: undefined, mono: item.mono ?? false, copyable: false, copyValue: undefined }))
  return <DescriptionListCard key={id} title={title} description="" items={rows} wrap={true} columns={2} titleAs="h3" onEdit={undefined} onCopy={undefined} editLabel="" className="min-w-0" />
}

export function useViewerLabels() {
  const { t } = useCopy()
  return { copyPath: t('json.copyPath'), copyValue: t('json.copyValue'), copied: t('json.copied'), copyFailed: t('json.copyFailed'), selectHint: t('json.selectHint'), truncated: t('json.truncated'), copyFullHint: t('json.copyFullHint'), keys: (count: number) => t('json.keys', { count }), items: (count: number) => t('json.items', { count }), root: t('json.root') }
}

export function Json({ value, label }: { value: unknown; label: string }) {
  const { t } = useCopy()
  const labels = useViewerLabels()
  const empty = value === null || value === undefined
  return <div className="min-w-0 space-y-2" data-testid="functions-json">
    <h4 className="text-sm font-medium text-foreground">{label}</h4>
    {empty ? <Text as="p" variant="body" tone="muted">{t('fields.none')}</Text>
      : <JsonViewer data={value} label={label} defaultExpandDepth={2} maxDepth={undefined} search="" toolbar={true} maxHeight={288} maxDisplayChars={undefined} emptyContent={undefined} labels={labels} className="min-w-0" />}
  </div>
}

function Snippets({ action }: { action: FunctionAction }) {
  const { t } = useCopy()
  return <section aria-label={t('snippets.title')} className="min-w-0 space-y-4" data-testid="functions-snippets">
    <SectionHeader title={t('snippets.title')} description={t('snippets.description')} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
    {functionSnippets(action).map((entry) => <div key={entry.id} className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground">{t(`snippets.${entry.label}`)}</h4>
        <CopyButton value={entry.code} display="label" label={t('snippets.copy')} copiedLabel={t('snippets.copied')} announcement={t('snippets.copiedAnnouncement')} failureLabel={t('snippets.copyFailed')} failureAnnouncement={t('snippets.copyFailed')} variant="secondary" size="md" aria-label={t('snippets.copyLabel', { label: t(`snippets.${entry.label}`) })} className={focusRing} />
      </div>
      <CodeBlock code={entry.code} language={entry.language} filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={undefined} label={t(`snippets.${entry.label}`)} className="min-w-0" />
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {entry.notes.includes('curl') && <li>{t('snippets.noteCurl')}</li>}
        {entry.notes.includes('external') && <li>{t('snippets.noteExternal')}</li>}
        {entry.state && <li>{t('snippets.noteState', { state: entry.state })}</li>}
        {entry.notes.includes('missing') && <li>{t('snippets.noteMissing')}</li>}
      </ul>
      <Text as="p" variant="supporting" tone="muted"><span className="font-medium text-foreground">{t('snippets.secrets')}</span> {t('snippets.secretRef')}</Text>
    </div>)}
  </section>
}

// One event per version, newest first, and nothing else (legacy has no history source beyond the versions).
function History({ s }: { s: Fn }) {
  const { t } = useCopy()
  const { versions } = s
  let body
  if (versions.failure) body = <FailurePanel section="versions" failure={versions.failure} retry={s.retryVersions} retrying={versions.phase === 'loading'} />
  else if (versions.phase !== 'ok' || !versions.data) body = <Loading label={t('versions.loading')} rows={2} columns={2} />
  else {
    const stamp = (item: FunctionVersion) => Date.parse(item.timestamps?.createdAt ?? '') || 0
    const events = [...(versions.data.items ?? [])].sort((a, b) => stamp(b) - stamp(a)).map((item) => ({
      id: item.versionId,
      status: statusLabel(t, item.status),
      tone: dotTone(item.status),
      title: t('history.event', { number: item.versionNumber ?? t('history.unknownVersion') }),
      description: t('history.eventDescription', { id: item.versionId, origin: formatEnumLabel(item.originType) }),
      at: item.timestamps?.createdAt ?? '',
      actor: undefined,
      live: false,
    }))
    body = <StatusTimeline events={events} label={t('history.label')} emptyLabel={t('history.empty')} showFewerLabel={t('history.showFewer')} showEarlierLabel={(count: number) => t('history.showEarlier', { count })} actorLabel={t('history.actor')} maxVisible={undefined} timeFormat="absolute" className="min-w-0" />
  }
  return <section aria-label={t('history.title')} className="min-w-0 space-y-3" data-testid="functions-history">
    <SectionHeader title={t('history.title')} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
    {body}
  </section>
}

export function DetailTab({ s }: { s: Fn }) {
  const { t } = useCopy()
  const { detail } = s
  if (detail.failure) return <SectionFailure section="detail" failure={detail.failure} retry={s.retryDetail} retrying={detail.phase === 'loading'} onBack={() => document.getElementById('functions-inventory-title')?.focus()} />
  if (detail.phase !== 'ok' || !detail.data) return <Loading label={t('detail.loading')} rows={4} columns={2} />
  const a = detail.data
  const refs = a.secretReferences?.map((item) => item.secretName).join(', ') || '—'
  return <div className="min-w-0 space-y-6" data-testid="functions-detail">
    {card(t, 'identity', t('identity.title'), [
      { id: 'actionName', label: t('identity.actionName'), value: a.actionName },
      { id: 'resourceId', label: t('identity.resourceId'), value: a.resourceId, mono: true },
      { id: 'packageName', label: t('identity.packageName'), value: a.packageName },
      { id: 'namespace', label: t('identity.namespace'), value: a.namespaceName },
      { id: 'activeVersion', label: t('identity.activeVersion'), value: a.activeVersionId, mono: true },
      { id: 'digest', label: t('identity.digest'), value: a.deploymentDigest, mono: true },
    ])}
    {card(t, 'execution', t('execution.title'), [
      { id: 'runtime', label: t('execution.runtime'), value: a.execution?.runtime },
      { id: 'entrypoint', label: t('execution.entrypoint'), value: a.execution?.entrypoint },
      { id: 'timeout', label: t('execution.timeout'), value: a.execution?.limits?.timeoutMs },
      { id: 'memory', label: t('execution.memory'), value: a.execution?.limits?.memoryMb },
      { id: 'concurrent', label: t('execution.concurrent'), value: a.execution?.limits?.concurrentInvocations },
      { id: 'retention', label: t('execution.retention'), value: a.activationPolicy?.retentionDays },
    ])}
    <Snippets action={a} />
    {card(t, 'advanced', t('advanced.title'), [
      { id: 'sourceKind', label: t('advanced.sourceKind'), value: a.source?.kind },
      { id: 'httpEnabled', label: t('advanced.httpEnabled'), value: a.httpExposure?.enabled },
      { id: 'httpUrl', label: t('advanced.httpUrl'), value: a.httpExposure?.publicUrl },
      { id: 'httpAuth', label: t('advanced.httpAuth'), value: a.httpExposure?.authPolicy },
      { id: 'provisioningState', label: t('advanced.provisioningState'), value: a.provisioning?.state },
      { id: 'failureClass', label: t('advanced.failureClass'), value: a.provisioning?.failureClass },
    ])}
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <Json value={a.execution?.environment} label={t('advanced.environment')} />
      <Json value={a.execution?.parameters} label={t('advanced.parameters')} />
    </div>
    {card(t, 'secrets', t('secrets.title'), [
      { id: 'refs', label: t('secrets.refs'), value: refs },
      { id: 'createdAt', label: t('secrets.createdAt'), value: a.timestamps?.createdAt },
      { id: 'updatedAt', label: t('secrets.updatedAt'), value: a.timestamps?.updatedAt },
      { id: 'rollbackAvailable', label: t('secrets.rollbackAvailable'), value: a.rollbackAvailable },
    ])}
    <History s={s} />
  </div>
}
