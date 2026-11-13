import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { Badge, StatusTag } from '@gntik-ai/ui'
import { InlineCallout } from '@gntik-ai/blocks'
import { failureOf, previewDdl, type Kind, type PgMatView, type PgView, type Preview } from './api'
import { useCopy, focusRing } from './copy'
import { Action, FailureView, Heading, Loading } from './States'
import { Code } from './Snippets'
export const riskTone = (risk: string) => risk === 'critical' || risk === 'high' ? 'destructive' : risk === 'medium' ? 'warning' : risk === 'low' ? 'success' : 'neutral'
export function Risk({ value }: { value: string }) {
  const { t } = useCopy()
  const label = t(`enums.${value}`, { defaultValue: value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) })
  return <StatusTag status={value} statuses={{ [value]: { label, tone: riskTone(value) } }} label={label} uppercase={false} variant="soft" size="sm" shape="rounded" className="max-w-full" />
}
export function Tag({ children }: { children: ComponentProps<typeof Badge>['children'] }) { return <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{children}</Badge> }
export function PreviewPanel({ context, target, close, opener }: { context: Parameters<typeof previewDdl>[0]; target: { kind: Kind; name: string; resource?: PgView | PgMatView }; close: () => void; opener: HTMLElement | null }) {
  const { t } = useCopy()
  const [data, setData] = useState<Preview | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState<ReturnType<typeof failureOf> | null>(null)
  const heading = useRef<HTMLDivElement>(null), token = useRef(0), live = useRef(true)
  async function send() {
    const generation = ++token.current
    setBusy(true); setData(null); setError(null)
    try { const result = await previewDdl(context, target.kind, target.name, target.resource); if (live.current && generation === token.current) setData(result) }
    catch (cause) {
      if (live.current && generation === token.current) {
        const known = cause instanceof Error && ['previewPrerequisite', 'viewQueryMissing', 'matviewQueryMissing', 'previewMissing'].includes(cause.message) ? cause.message : null
        setError({ ...failureOf(cause), message: known ? t(known) : undefined })
      }
    } finally { if (live.current && generation === token.current) setBusy(false) }
  }
  useEffect(() => { live.current = true; heading.current?.focus(); void send(); return () => { live.current = false; token.current++ } }, [])
  const yes = (value: boolean) => t(value ? 'yes' : 'no')
  const humanize = (value: string) => t(`enums.${value}`, { defaultValue: value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) })
  const risk = data?.riskProfile, ddl = data?.ddlPreview
  return <section className="min-w-0 space-y-4" aria-label={t('preview')} data-testid="pg-preview">
    <div className="flex flex-wrap items-start justify-between gap-2"><div ref={heading} tabIndex={-1} className={focusRing}><Heading title={t('previewTitle', { name: target.name })} description={t('previewDescription')} /></div><Action onClick={() => { close(); opener?.focus() }}>{t('close')}</Action></div>
    {busy ? <div role="status"><Loading label={t('previewLoading')} /></div> : error ? <FailureView error={error} section="preview" retry={() => void send()} /> : <>
      {risk && <div className="flex flex-wrap gap-2"><Risk value={risk.riskLevel} />{[['statements', risk.statementCount], ['locks', risk.lockTargetCount], ['destructive', yes(risk.destructive)], ['blocking', yes(risk.blockingLikely)], ['acknowledgement', yes(risk.acknowledgementRequired)]].map(([key, value]) => <Tag key={key}>{t('labelValue', { label: t(String(key)), value })}</Tag>)}</div>}
      {Boolean(data?.preExecutionWarnings?.length) && <Heading title={t('warnings')} level="h3" />}
      {data?.preExecutionWarnings?.map((warning) => <div key={warning.warningCode} data-severity={warning.severity} className="space-y-2"><div className="flex flex-wrap gap-2"><Risk value={warning.severity} /><Tag>{humanize(warning.category)}</Tag><Tag>{t('labelValue', { label: t('confirmation'), value: yes(warning.requiresAcknowledgement) })}</Tag></div><InlineCallout tone={riskTone(warning.severity) === 'destructive' ? 'destructive' : riskTone(warning.severity) === 'warning' ? 'warning' : 'info'} title={warning.summary} description={warning.detail ?? ''} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} /></div>)}
      {ddl && <>
        <div className="flex flex-wrap gap-2"><Tag>{t('labelValue', { label: t('executionMode'), value: humanize(ddl.executionMode) })}</Tag><Tag>{t('labelValue', { label: t('transactionMode'), value: humanize(ddl.transactionMode) })}</Tag><Tag>{t('labelValue', { label: t('statements'), value: ddl.statementCount })}</Tag></div>
        {Boolean(ddl.safeGuards?.length) && <><Heading title={t('safeguards')} level="h3" /><ul className="list-inside list-disc">{ddl.safeGuards?.map((guard) => <li key={guard}>{guard}</li>)}</ul></>}
        {Boolean(ddl.lockTargets?.length) && <><Heading title={t('lockTargets')} level="h3" /><div className="flex flex-wrap gap-2">{ddl.lockTargets?.map((value) => <Tag key={value}>{value}</Tag>)}</div></>}
        {ddl.statements.map((statement) => <article key={statement.ordinal} className="min-w-0 space-y-3"><div className="flex flex-wrap gap-2"><Tag>{t('statementOrdinal', { number: statement.ordinal })}</Tag><Tag>{humanize(statement.category)}</Tag><Tag>{t('labelValue', { label: t('destructive'), value: yes(statement.destructive) })}</Tag></div><Code code={statement.sql} label={t('preview')} /></article>)}
      </>}
    </>}
  </section>
}
