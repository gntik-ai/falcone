import { Play } from 'lucide-react'
import { Alert, Button, CodeBlock, Field, FieldLabel, SimpleSelect, Text, Textarea } from '@gntik-ai/ui'
import { InlineCallout, SectionHeader } from '@gntik-ai/blocks'
import { focusRing, showLimitsHint, useCopy } from './copy'
import { Json } from './DetailTab'
import { Empty, FailurePanel, FunctionStatus } from './States'
import { WRITE_REASON_ID } from './VersionsTab'
import type { Fn } from './useFunctions'
import type { ResponseMode } from './api'

const PAYLOAD_ID = 'functions-invoke-payload'
const MODE_ID = 'functions-response-mode'

export function InvokeTab({ s }: { s: Fn }) {
  const { t } = useCopy()
  const { invokeOp } = s
  if (!s.selectedId) return <Empty title={t('invoke.selectFirst')} />
  const invalid = invokeOp.validation !== null
  const activationId = invokeOp.data ? s.activationIdFor(invokeOp.data) : null
  return <div className="min-w-0 space-y-4" data-testid="functions-invoke">
    <SectionHeader title={t('invoke.title')} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
    <Field invalid={invalid} disabled={false} className="min-w-0">
      <FieldLabel htmlFor={PAYLOAD_ID}>{t('invoke.payload')}</FieldLabel>
      <Textarea id={PAYLOAD_ID} value={s.parametersJson} onChange={(event) => s.setParametersJson(event.target.value)} invalid={invalid} aria-describedby={invalid ? 'functions-invoke-validation' : undefined} disabled={false} rows={6} resize="vertical" size="md" spellCheck={false} autoComplete="off" className="min-w-0 font-mono" />
    </Field>
    {invalid && <div id="functions-invoke-validation" role="alert" className="min-w-0"><InlineCallout tone="destructive" title={t(invokeOp.validation === 'object' ? 'invoke.invalidObject' : 'invoke.invalidJson')} labels={{ title: t(invokeOp.validation === 'object' ? 'invoke.invalidObject' : 'invoke.invalidJson') }} description={null} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div>}
    <Field invalid={false} disabled={false} className="min-w-0 max-w-sm">
      <FieldLabel htmlFor={MODE_ID}>{t('invoke.responseMode')}</FieldLabel>
      <SimpleSelect id={MODE_ID} value={s.responseMode} defaultValue="accepted" placeholder={t('invoke.responseMode')} clearable={false} size="md" className="w-full min-w-0"
        items={[{ value: 'accepted', label: t('invoke.accepted') }, { value: 'wait_for_result', label: t('invoke.wait_for_result') }]} onValueChange={(value) => { if (value) s.setResponseMode(value as ResponseMode) }} />
    </Field>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button type="button" variant="primary" size="md" loading={false} disabled={!s.selectedId || s.writeBlocked || invokeOp.busy} iconOnly={false} icon={Play as never} trailingIcon={undefined}
        aria-describedby={s.writeReason ? WRITE_REASON_ID : undefined} aria-busy={invokeOp.busy} className={focusRing} onClick={() => void s.invoke()}>{invokeOp.busy ? t('invoke.busy') : t('invoke.action')}</Button>
    </div>
    {invokeOp.failure && <div className="min-w-0 space-y-2">
      <FailurePanel section="invoke" failure={invokeOp.failure} retry={() => void s.invoke()} retrying={invokeOp.busy} canRetry={!s.writeBlocked} />
      {showLimitsHint(invokeOp.failure) && <Text as="p" variant="body" tone="muted" data-testid="functions-limits-hint">{t('errors.limitsHint')}</Text>}
    </div>}
    {invokeOp.data && <div role="status" data-testid="functions-invoke-result" className="min-w-0 space-y-3">
      <Alert tone="success" title={t('invoke.resultTitle')} actions={undefined} icon={undefined} onDismiss={undefined} dismissLabel=""
        description={<span className="flex flex-wrap items-center gap-2"><FunctionStatus value={invokeOp.data.status} /></span>} />
      <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0 break-words"><dt className="inline font-semibold">{t('invoke.invocationId')}</dt> <dd className="inline font-mono text-xs">{invokeOp.data.invocationId}</dd></div>
        {activationId && <div className="min-w-0 break-words"><dt className="inline font-semibold">{t('invoke.activation')}</dt> <dd className="inline font-mono text-xs">{activationId}</dd></div>}
        <div className="min-w-0 break-words"><dt className="inline font-semibold">{t('invoke.acceptedAt')}</dt> <dd className="inline">{invokeOp.data.acceptedAt}</dd></div>
      </dl>
      {activationId && <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => { s.openActivation(activationId); s.changeTab('activations') }}>{t('invoke.viewActivation')}</Button>}
      {invokeOp.data.result !== undefined && (typeof invokeOp.data.result === 'object' && invokeOp.data.result !== null
        ? <div data-testid="functions-invoke-inline-result" className="min-w-0"><Json value={invokeOp.data.result} label={t('invoke.inlineResult')} /></div>
        : <div data-testid="functions-invoke-inline-result" className="min-w-0"><CodeBlock code={invokeOp.data.result === null ? 'null' : typeof invokeOp.data.result === 'string' ? invokeOp.data.result : JSON.stringify(invokeOp.data.result, null, 2)} language="text" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={288} highlight={undefined} label={t('invoke.inlineResult')} className="min-w-0" /></div>)}
      {invokeOp.data.logs?.length ? <div data-testid="functions-invoke-inline-logs" className="min-w-0"><CodeBlock code={invokeOp.data.logs.join('\n')} language="text" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={288} highlight={undefined} label={t('invoke.inlineLogs')} className="min-w-0" /></div> : null}
    </div>}
  </div>
}
