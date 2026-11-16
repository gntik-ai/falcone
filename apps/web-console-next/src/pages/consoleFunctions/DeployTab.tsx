import { useLayoutEffect, useRef } from 'react'
import { Alert, Field, FieldDescription, FieldLabel, Input, NumberInput, SimpleSelect, Text, Textarea } from '@gntik-ai/ui'
import { FormSection, StickyActionBar, ValidationSummary } from '@gntik-ai/blocks'
import type { DeployDraft } from './api'
import { describeFailure, focusRing, useCopy } from './copy'
import { FailurePanel, FunctionStatus, Loading } from './States'
import { WRITE_REASON_ID } from './VersionsTab'
import { FIELD_IDS, type Fn } from './useFunctions'

// The kit select cannot select an empty-string value, so the empty option uses this sentinel and maps to ''.
const NO_RUNTIME = '__no-runtime__'
const BASE_RUNTIMES = ['nodejs:20', 'nodejs:18']
// The leading empty item is the legacy 'Selecciona un entorno' option (:1422-1431), so a chosen runtime can be cleared again.
// Legacy :468-471: the current runtime stays selectable even when it is not one of the defaults.
const runtimeOptions = (value: string) => (!value || BASE_RUNTIMES.includes(value) ? BASE_RUNTIMES : [value, ...BASE_RUNTIMES])
const numberOf = (text: string) => (text.trim() === '' || Number.isNaN(Number(text)) ? null : Number(text))

export function DeployTab({ s }: { s: Fn }) {
  const { t } = useCopy()
  const bar = useRef<HTMLDivElement>(null)
  const { draft, deployOp, issues } = s
  const creating = s.mode === 'create'
  const set = (field: keyof DeployDraft) => (value: string) => s.setDraft((current) => ({ ...current, [field]: value }))
  // The kit bar has no way to disable Save for a blocked write or to reference the reason, so both are applied to its button.
  useLayoutEffect(() => {
    const save = bar.current?.querySelector('section button:last-of-type') as HTMLButtonElement | null
    if (!save) return
    if (s.writeBlocked || deployOp.busy) save.disabled = true
    if (s.writeReason) save.setAttribute('aria-describedby', WRITE_REASON_ID); else save.removeAttribute('aria-describedby')
  })
  const invalid = (id: string) => issues.some((issue) => issue.fieldId === id)
  if (!creating && s.detail.phase !== 'ok') return s.detail.failure
    ? <FailurePanel section="detail" failure={s.detail.failure} retry={s.retryDetail} retrying={s.detail.phase === 'loading'} />
    : <Loading label={t('detail.loading')} rows={4} columns={2} />
  const errors = issues.map((issue) => ({ fieldId: issue.fieldId, label: '', message: t(`form.${issue.message}`) }))
  return <form noValidate onSubmit={(event) => { event.preventDefault(); void s.submitDeploy() }} className="min-w-0 space-y-6" data-testid="functions-deploy" aria-label={t('form.title')}>
    {errors.length > 0 && <ValidationSummary errors={errors} submitCount={s.submitCount} title={t('form.validationTitle')} labels={{ title: () => t('form.validationTitle') }} className="min-w-0" />}
    <FormSection title={t('form.identity')} description={t('form.identityHelp')} headingLevel="h3" divided={false} actions={undefined} labels={{}} className="min-w-0">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Field invalid={invalid(FIELD_IDS.actionName)} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={FIELD_IDS.actionName}>{t('form.actionName')}</FieldLabel>
          <Input id={FIELD_IDS.actionName} type="text" size="md" value={draft.actionName} disabled={!creating} invalid={invalid(FIELD_IDS.actionName)} autoComplete="off" spellCheck={false}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 font-mono ${focusRing}`} onChange={(event) => set('actionName')(event.target.value)} />
        </Field>
        <Field invalid={invalid(FIELD_IDS.runtime)} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={FIELD_IDS.runtime}>{t('form.runtime')}</FieldLabel>
          <SimpleSelect id={FIELD_IDS.runtime} value={draft.runtime || NO_RUNTIME} placeholder={t('form.runtimePlaceholder')} clearable={false} size="md" className="w-full min-w-0"
            items={[{ value: NO_RUNTIME, label: t('form.runtimePlaceholder') }, ...runtimeOptions(draft.runtime).map((runtime) => ({ value: runtime, label: runtime }))]} onValueChange={(value) => set('runtime')(!value || value === NO_RUNTIME ? '' : value)} />
        </Field>
        <Field invalid={invalid(FIELD_IDS.entrypoint)} disabled={false} className="min-w-0 md:col-span-2">
          <FieldLabel htmlFor={FIELD_IDS.entrypoint}>{t('form.entrypoint')}</FieldLabel>
          <Input id={FIELD_IDS.entrypoint} type="text" size="md" value={draft.entrypoint} invalid={invalid(FIELD_IDS.entrypoint)} autoComplete="off" spellCheck={false}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 font-mono ${focusRing}`} onChange={(event) => set('entrypoint')(event.target.value)} />
        </Field>
      </div>
    </FormSection>
    <FormSection title={t('form.limits')} description={t('form.limitsHelp')} headingLevel="h3" divided={true} actions={undefined} labels={{}} className="min-w-0">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={FIELD_IDS.timeoutMs}>{t('form.timeout')}</FieldLabel>
          <NumberInput id={FIELD_IDS.timeoutMs} value={numberOf(draft.timeoutMs)} onValueChange={(value) => set('timeoutMs')(value === null ? '' : String(value))} size="md" hideSteppers={true} className="w-full min-w-0" />
        </Field>
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={FIELD_IDS.memoryMb}>{t('form.memory')}</FieldLabel>
          <NumberInput id={FIELD_IDS.memoryMb} value={numberOf(draft.memoryMb)} onValueChange={(value) => set('memoryMb')(value === null ? '' : String(value))} size="md" hideSteppers={true} className="w-full min-w-0" />
        </Field>
      </div>
    </FormSection>
    <FormSection title={t('form.code')} description={t('form.codeHelp')} headingLevel="h3" divided={true} actions={undefined} labels={{}} className="min-w-0">
      <Field invalid={false} disabled={false} className="min-w-0">
        <FieldLabel htmlFor={FIELD_IDS.inlineCode}>{t('form.inlineCode')}</FieldLabel>
        <Textarea id={FIELD_IDS.inlineCode} value={draft.inlineCode} onChange={(event) => set('inlineCode')(event.target.value)} invalid={false} disabled={false} rows={10} resize="vertical" size="md" spellCheck={false} autoComplete="off" className="min-w-0 font-mono" />
        <FieldDescription className="sr-only">{t('form.codeHelp')}</FieldDescription>
      </Field>
    </FormSection>
    {deployOp.failure && <FailurePanel section="deploy" failure={deployOp.failure} message={describeFailure(t, deployOp.failure, 'deploy')} retry={() => void s.submitDeploy()} retrying={deployOp.busy} />}
    {deployOp.data && <div role="status" data-testid="functions-deploy-result" className="min-w-0"><Alert tone="success" title={t('form.acceptedTitle')} actions={undefined} icon={undefined} onDismiss={undefined} dismissLabel=""
      description={<span className="flex min-w-0 flex-wrap items-center gap-2">{deployOp.data.status && <FunctionStatus value={deployOp.data.status} />}{deployOp.data.resourceId && <Text as="span" variant="body" tone="default" className="break-all">{t('form.resource', { id: deployOp.data.resourceId })}</Text>}</span>} /></div>}
    <div ref={bar} className="min-w-0">
      <StickyActionBar dirty={s.dirty} saving={deployOp.busy} onSave={() => void s.submitDeploy()} onCancel={s.discardDraft} dirtyMessage={t('form.dirty')} cleanMessage={t('form.clean')} saveLabel={t(creating ? 'form.create' : 'form.update')} cancelLabel={t('form.discard')} hideWhenClean={false} aria-label={t('form.actionBar')} className="min-w-0" />
    </div>
  </form>
}
