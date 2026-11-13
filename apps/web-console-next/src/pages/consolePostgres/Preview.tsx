import { useEffect, useRef, useState } from 'react'
import { StatusTag, Text } from '@gntik-ai/ui'
import { failureOf, preview, PreviewValidation, type PreviewContext, type PreviewResponse, type PreviewTarget } from './api'
import { Action, Code, Heading, Loading, Notice, Tag } from './Parts'
import { formatLabel, useCopy } from './copy'

export function Preview({ context, target, close, trigger }: { context: PreviewContext; target: PreviewTarget; close: () => void; trigger: HTMLElement | null }) {
  const { t } = useCopy()
  const [response, setResponse] = useState<PreviewResponse | null>(null)
  const [error, setError] = useState<{ key: string; requestId?: string } | null>(null)
  const [loading, setLoading] = useState(true), [revision, setRevision] = useState(0)
  const cached = useRef<Promise<PreviewResponse> | null>(null)
  const retryRef = useRef(-1)
  useEffect(() => {
    let live = true
    setLoading(true); setError(null); setResponse(null)
    if (!cached.current || retryRef.current !== revision) { retryRef.current = revision; cached.current = preview(context, target) }
    void cached.current.then((value) => { if (live) setResponse(value) }).catch((cause: unknown) => {
      if (live) {
        const failure = failureOf(cause), status = failure.status
        const key = status === 401 || status === 403 || status === 404 || status === 409 || status === 429 ? `http${status}` : status && status >= 500 ? 'http500' : 'previewError'
        setError({ key: cause instanceof PreviewValidation ? cause.key : key, requestId: failure.requestId })
      }
    }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [context, target, revision])
  const label = (value?: string) => value ? t(`values.${value}`, { defaultValue: formatLabel(value) }) : t('none')
  const bool = (value: boolean) => t(value ? 'yes' : 'no')
  const risk = response?.riskProfile, ddl = response?.ddlPreview
  const riskTag = (value: string) => <StatusTag status={value} label={label(value)} statuses={{ [value]: { label: label(value), tone: value === 'critical' || value === 'high' ? 'destructive' : value === 'medium' ? 'warning' : value === 'low' ? 'success' : 'neutral' } }} variant="outline" size="sm" shape="rounded" uppercase={false} className="" />
  return <section aria-label={t('previewTitle', { name: target.name })} className="min-w-0 space-y-4" data-testid="pg-preview">
    <div className="flex flex-wrap items-start justify-between gap-3"><Heading title={t('previewTitle', { name: target.name })} description={t('previewDescription')} /><Action onClick={() => { close(); trigger?.focus() }}>{t('close')}</Action></div>
    {loading ? <Loading label={t('previewLoading')} /> : error ? <div role="alert" className="space-y-3"><Notice tone="warning" title={t(error.key)} description={error.requestId ? t('requestIdValue', { id: error.requestId }) : ''} /><Action onClick={() => setRevision((value) => value + 1)}>{t('retry')}</Action></div> : <>
      {risk && <div className="flex flex-wrap gap-2">{riskTag(risk.riskLevel)}<Tag>{t('statements', { count: risk.statementCount })}</Tag><Tag>{t('locks', { count: risk.lockTargetCount })}</Tag><Tag>{t('destructive', { value: bool(risk.destructive) })}</Tag><Tag>{t('blocking', { value: bool(risk.blockingLikely) })}</Tag><Tag>{t('acknowledgement', { value: bool(risk.acknowledgementRequired) })}</Tag></div>}
      {(response?.preExecutionWarnings?.length ?? 0) > 0 && <Heading title={t('warnings')} description="" level="h3" />}
      {response?.preExecutionWarnings?.map((warning) => <div key={warning.warningCode} data-severity={warning.severity} className="min-w-0 space-y-2"><div className="flex flex-wrap gap-2">{riskTag(warning.severity)}<Tag>{label(warning.category)}</Tag><Tag>{t('confirmation', { value: bool(warning.requiresAcknowledgement) })}</Tag></div><Notice tone={warning.severity === 'low' ? 'info' : 'warning'} title={warning.summary} description={warning.detail ?? ''} /></div>)}
      {ddl && <>
        <div className="flex flex-wrap gap-2"><Tag>{t('executionMode', { value: label(ddl.executionMode) })}</Tag><Tag>{t('transaction', { value: label(ddl.transactionMode) })}</Tag><Tag>{t('statements', { count: ddl.statementCount })}</Tag></div>
        {!!ddl.safeGuards?.length && <div><Heading title={t('safeguards')} description="" level="h3" /><ul className="list-disc pl-5">{ddl.safeGuards.map((guard) => <li key={guard}><Text variant="body" tone="muted">{guard}</Text></li>)}</ul></div>}
        {!!ddl.lockTargets?.length && <div className="space-y-2"><Heading title={t('lockTargets')} description="" level="h3" /><div className="flex flex-wrap gap-2">{ddl.lockTargets.map((item) => <Tag key={item}>{item}</Tag>)}</div></div>}
        {ddl.statements.map((statement) => <div key={statement.ordinal} className="min-w-0 space-y-2"><div className="flex flex-wrap gap-2"><Tag>{t('statementOrdinal', { number: statement.ordinal })}</Tag><Tag>{label(statement.category)}</Tag><Tag>{t('destructive', { value: bool(statement.destructive) })}</Tag></div><Code code={statement.sql} label={t('statementOrdinal', { number: statement.ordinal })} language="sql" /></div>)}
      </>}
    </>}
  </section>
}
