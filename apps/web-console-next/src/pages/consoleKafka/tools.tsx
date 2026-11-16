import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Field, FieldLabel, Input, JsonViewer, StatusDot, Textarea } from '@gntik-ai/ui'
import { FormSection, LogViewer } from '@gntik-ai/blocks'
import * as api from './api'
import { focusRing, useCopy } from './copy'
import { statusMessage, useStream } from './hooks'
import { Action, Empty, Notice, Values } from './parts'
import type { KafkaPublishAccepted } from './types'

export interface PublishFields { form: { payload: string; eventType: string; key: string; contentType: string }; setForm: Dispatch<SetStateAction<PublishFields['form']>> }
export const initialPublishForm = { payload: '', eventType: '', key: '', contentType: 'application/json' }
export function Publish({ resourceId, form, setForm }: { resourceId: string } & PublishFields) {
  const { t } = useCopy()
  const [busy, setBusy] = useState(false), [result, setResult] = useState<KafkaPublishAccepted | null>(null), [error, setError] = useState<api.Failure | null>(null)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function submit() {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(null); setResult(null)
    try { const data = await api.publish(resourceId, api.publishBody(form), controller.signal); if (!controller.signal.aborted) setResult(data) }
    catch (cause) { if (!controller.signal.aborted) setError(api.failureOf(cause)) }
    finally { if (!controller.signal.aborted) { setBusy(false); pending.current = null } }
  }
  return <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
    <FormSection title={t('publish')} description="" headingLevel="h3" divided={false} actions={null} labels={{ title: t('publish'), description: '' }} className="min-w-0">
      <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="kafka-payload">{t('jsonPayload')}</FieldLabel><Textarea id="kafka-payload" value={form.payload} onChange={(event) => setForm({ ...form, payload: event.target.value })} placeholder={t('missingValue')} rows={6} className={`w-full min-w-0 ${focusRing}`} /></Field>
      <div className="grid min-w-0 gap-4 md:grid-cols-3">{(['eventType', 'key', 'contentType'] as const).map((name) => <Field key={name} invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor={`kafka-${name}`}>{t(name === 'eventType' ? 'eventType' : name === 'key' ? 'key' : 'contentType')}</FieldLabel><Input id={`kafka-${name}`} type="text" size="md" value={form[name]} onChange={(event) => setForm({ ...form, [name]: event.target.value })} placeholder={name === 'eventType' ? t('comExampleEvent') : name === 'key' ? t('optional') : ''} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} /></Field>)}</div>
    </FormSection>
    <Action type="submit" aria-disabled={busy} aria-busy={busy}>{t('publishEvent')}</Action>
    <div role="status" aria-live="polite" aria-atomic={true}>{busy ? t('publishing') : result ? <Values raw={true} title={t('publish')} items={[{ label: t('publicationId'), value: result.publicationId }, { label: t('status'), value: result.status }, { label: t('acceptedAt'), value: result.acceptedAt }]} /> : null}</div>
    {error ? <div role="alert"><Notice>{statusMessage(t, error, 'couldNotPublishTheTestEvent')}{error.status === 429 ? <p>{t('checkDetailQuotasToVerifyLimitsOrLimitEnforcement')}</p> : null}</Notice></div> : null}
  </form>
}
export function Stream({ resourceId }: { resourceId: string }) {
  const { t } = useCopy(), stream = useStream(resourceId)
  const [selected, setSelected] = useState<string | undefined>()
  const inspected = stream.events.find((event) => event.id === selected)
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center gap-3"><Action aria-label={t(stream.active ? 'stopStream' : 'startStream')} onClick={() => { if (stream.active) stream.stop(); else { setSelected(undefined); void stream.start() } }}>{t(stream.active ? 'stopStream' : 'startStream')}</Action><StatusDot tone={stream.active ? 'success' : 'neutral'} size="sm" label={t(stream.active ? 'activeConnection' : 'inactive')} pulse={false} className="" /><span>{t(stream.active ? 'activeConnection' : 'inactive')}</span></div>
    {stream.highVolume ? <div role="alert"><Notice tone="warning">{t('highEventVolumeTheDisplayMayLagBehindTheBroker')}</Notice></div> : null}
    {stream.error ? <div role="alert" aria-live="assertive"><Notice>{stream.error}</Notice></div> : null}
    {!stream.events.length ? <Empty title={t(stream.active ? 'listeningForEvents' : 'startTheStreamToReceiveEvents')} /> : null}
    <LogViewer lines={stream.events.map((event) => ({ id: event.id, timestamp: event.receivedAt, level: 'info', message: `${event.key ? `${t('keyLabel')}: ${event.key} · ` : ''}${event.eventType ? `${t('eventtype')}: ${event.eventType} · ` : ''}${t('raw')}: ${event.raw}`, source: '' }))} title={t('events')} height={400} rowHeight={72} wrap={true} overscan={100} defaultLevels={['debug', 'info', 'warn', 'error']} defaultFollow={false} onCopyLine={undefined} onSelectLine={(line) => setSelected(line.id)} selectedLineId={selected} announceLines={false} titleAs="h3" className="min-w-0 max-w-full"
      labels={{ title: t('events'), levelFilter: t('levels'), levels: { debug: t('debug'), info: t('info'), warn: t('warning'), error: t('error') }, searchLabel: t('searchEvents'), searchPlaceholder: t('searchEvents'), follow: t('followEvents'), count: (visible, total) => t('eventCount', { visible, total }), empty: t(stream.active ? 'listeningForEvents' : 'startTheStreamToReceiveEvents'), inspect: () => t('inspectEvent'), copy: () => t('copy'), copied: t('copied'), copyFailed: t('couldNotCopy') }} />
    {inspected ? <JsonViewer data={inspected.payload} label={t('jsonPayload')} defaultExpandDepth={3} maxDepth={20} search="" toolbar={true} maxHeight={400} maxDisplayChars={20000} emptyContent={t('missingValueLabel')} className="min-w-0 max-w-full"
      labels={{ copyPath: t('copyPath'), copyValue: t('copyValue'), copied: t('copied'), copyFailed: t('couldNotCopy'), selectHint: t('selectAValue'), truncated: t('truncatedContent'), copyFullHint: t('copyFullValue'), keys: (count) => t('keys', { count }), items: (count) => `${count} ${t('items')}`, root: t('root') }} /> : null}
  </div>
}
