import { useEffect, useId, useRef } from 'react'
import { Alert, Button, Field, FieldLabel, Input, Text } from '@gntik-ai/ui'
import { FormSection } from '@gntik-ai/blocks'
import { VALUE_MAX, secretEnvVarName, type Failure } from './api'
import { classify, describeWrite, focusRing, useCopy } from './copy'
import { WriteFailure } from './States'
import type { Draft, Validation } from './useWorkspaceSecrets'

interface Props {
  draft: Draft
  validation: Validation
  pending: boolean
  failure: Failure | null
  success: string | null
  onField: (field: keyof Draft, value: string) => void
  onSubmit: () => void
}

// One form-section: name with its environment variable hint, the write-only value and an optional
// description. The value is masked, never prefilled, and the kit reveal toggle is deliberately not used.
export function CreateForm({ draft, validation, pending, failure, success, onField, onSubmit }: Props) {
  const { t } = useCopy()
  const id = useId()
  const submit = useRef<HTMLButtonElement>(null)
  const wasPending = useRef(false)
  const failureClass = failure ? classify(failure) : null
  // The submit button is disabled while pending, which drops focus. Non-retryable failures keep it in the form.
  useEffect(() => {
    if (wasPending.current && !pending && failureClass === 'inline' && !document.activeElement?.closest('form')) submit.current?.focus()
    wasPending.current = pending
  }, [pending, failureClass])
  const nameError = validation.name ? t(validation.name === 'required' ? 'validation.nameRequired' : 'validation.namePattern') : null
  const valueError = validation.value ? t(validation.value === 'required' ? 'validation.valueRequired' : 'validation.valueMax', { max: VALUE_MAX }) : null
  const nameDescribed = [`${id}-name-help`, nameError ? `${id}-name-error` : null].filter(Boolean).join(' ')
  const valueDescribed = [`${id}-value-help`, valueError ? `${id}-value-error` : null].filter(Boolean).join(' ')
  return <FormSection title={t('create.title')} description={t('create.description')} headingLevel="h2" divided={false} actions={null} labels={{ title: t('create.title'), description: t('create.description') }} className="min-w-0" data-testid="workspace-secrets-create">
    <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} noValidate className="min-w-0 space-y-5">
      <div className="grid min-w-0 gap-x-4 gap-y-5 md:grid-cols-2">
        <Field invalid={Boolean(nameError)} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={`${id}-name`}>{t('create.nameLabel')}</FieldLabel>
          <Input id={`${id}-name`} data-secret-field="name" type="text" size="md" value={draft.name} readOnly={pending} invalid={Boolean(nameError)} aria-invalid={nameError ? true : undefined} aria-describedby={nameDescribed}
            placeholder={t('create.namePlaceholder')} autoComplete="off" spellCheck={false} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`}
            onChange={(event) => onField('name', event.target.value)} />
          <Text as="span" variant="supporting" tone="muted" id={`${id}-name-help`} className="break-words">
            {draft.name ? <>{t('create.envVar')} <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground break-all">{secretEnvVarName(draft.name)}</code></> : t('create.nameHelp')}
          </Text>
          {nameError && <Text as="p" variant="body" tone="destructive" id={`${id}-name-error`} role="alert" data-secret-error="name">{nameError}</Text>}
        </Field>
        <Field invalid={Boolean(valueError)} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={`${id}-value`}>{t('create.valueLabel')}</FieldLabel>
          <Input id={`${id}-value`} data-secret-field="value" type="password" size="md" value={draft.value} readOnly={pending} invalid={Boolean(valueError)} aria-invalid={valueError ? true : undefined} aria-describedby={valueDescribed}
            placeholder={t('create.valuePlaceholder')} autoComplete="new-password" leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`}
            onChange={(event) => onField('value', event.target.value)} />
          <Text as="span" variant="supporting" tone="muted" id={`${id}-value-help`}>{t('create.valueHelp')}</Text>
          {valueError && <Text as="p" variant="body" tone="destructive" id={`${id}-value-error`} role="alert" data-secret-error="value">{valueError}</Text>}
        </Field>
        <Field invalid={false} disabled={false} className="min-w-0 md:col-span-2">
          <FieldLabel htmlFor={`${id}-description`}>{t('create.descriptionLabel')}</FieldLabel>
          <Input id={`${id}-description`} data-secret-field="description" type="text" size="md" value={draft.description} readOnly={pending} placeholder={t('create.descriptionPlaceholder')} autoComplete="off"
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => onField('description', event.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button ref={submit} type="submit" variant="primary" size="md" loading={pending} disabled={pending} aria-busy={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={`w-full sm:w-auto ${focusRing}`}>{pending ? t('create.busy') : t('create.submit')}</Button>
      </div>
      {failure && (classify(failure) === 'retry'
        ? <WriteFailure kind="create" failure={failure} retry={onSubmit} retrying={pending} target="create" />
        : <div data-testid="workspace-secrets-create-error"><Alert tone="destructive" role={undefined} title={undefined} description={describeWrite(t, 'create', failure)} actions={undefined} icon={undefined} onDismiss={undefined} dismissLabel="" /></div>)}
    </form>
    <div aria-live="polite" className="mt-4 min-w-0">
      {success && <Alert tone="success" role="status" title={undefined} description={success} actions={undefined} icon={undefined} onDismiss={undefined} dismissLabel="" data-testid="workspace-secrets-create-success" />}
    </div>
  </FormSection>
}
