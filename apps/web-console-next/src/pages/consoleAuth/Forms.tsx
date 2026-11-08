import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Checkbox, Field, FieldError, FieldLabel, Input, SimpleSelect, Textarea } from '@gntik-ai/ui'
import { FormSection, StickyActionBar, ValidationSummary, type ValidationIssue } from '@gntik-ai/blocks'
import {
  EMPTY_APPLICATION, EMPTY_PROVIDER, FLOWS, toApplicationForm, toProviderForm, validateApplication, validateProvider,
  type Application, type ApplicationForm, type FormErrors, type Provider, type ProviderForm, type ProviderMode,
} from './api'
import { Callout, focusRing, useCopy } from './ui'

// The form owns its values, so a failed save keeps everything the user typed. `onSubmit` resolves to a
// localized failure message, or null once the request succeeded.
type Submit<T> = (form: T) => Promise<string | null>

function TextField({ id, label, value, onChange, error, disabled = false, required = false }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean; required?: boolean }) {
  const invalid = Boolean(error)
  return <Field invalid={invalid} className="min-w-0">
    <FieldLabel htmlFor={id} required={required}>{label}</FieldLabel>
    <Input id={id} value={value} onValueChange={(next) => onChange(String(next))} invalid={invalid} disabled={disabled} autoComplete="off" spellCheck={false} className={`w-full min-w-0 ${focusRing}`} />
    {error && <FieldError match={true}>{error}</FieldError>}
  </Field>
}
function AreaField({ id, label, value, onChange, error, rows }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; rows: number }) {
  const invalid = Boolean(error)
  return <Field invalid={invalid} className="min-w-0">
    <FieldLabel htmlFor={id} required={false}>{label}</FieldLabel>
    <Textarea id={id} value={value} rows={rows} onValueChange={onChange} invalid={invalid} spellCheck={false} className={`w-full min-w-0 ${focusRing}`} />
    {error && <FieldError match={true}>{error}</FieldError>}
  </Field>
}
function Choice<V extends string>({ label, value, items, onChange, disabled = false }: { label: string; value: V; items: { value: V; label: string }[]; onChange: (value: V) => void; disabled?: boolean }) {
  const { t } = useCopy()
  return <SimpleSelect<V> label={label} value={value} items={items} onValueChange={(next) => { if (next) onChange(next) }} placeholder={undefined} clearable={false} clearLabel={t('clear')} onClear={undefined} size="md" disabled={disabled}
    loadOptions={undefined} loadingText={t('loading')} errorText={t('optionsFailure')} emptyText={t('noOptions')} className={`w-full min-w-0 ${focusRing}`} />
}

function useFormState<T extends object>(initial: T, validate: (form: T) => FormErrors, ids: Record<string, string>, labels: Record<string, string>, submit: Submit<T>) {
  const { t } = useCopy()
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submits, setSubmits] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const set = <K extends keyof T>(key: K, value: T[K]) => setForm((current) => ({ ...current, [key]: value }))
  const message = (field: string) => (field in errors ? t(`validation.${errors[field]}`) : undefined)
  const issues: ValidationIssue[] = Object.keys(errors).map((field) => ({ fieldId: ids[field], label: labels[field], message: message(field)! }))
  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    const found = validate(form)
    setErrors(found); setSubmits((count) => count + 1)
    if (Object.keys(found).length) return
    inFlight.current = true; setPending(true); setFailure(null)
    try { setFailure(await submit(form)) } finally { inFlight.current = false; setPending(false) }
  }
  return { form, set, message, issues, submits, failure, pending, onSubmit }
}

function Frame({ title, description, headingLevel, state, formRef, onSubmit, children, saveLabel, cancelLabel, onCancel, name }: {
  title: string; description: string; headingLevel: 'h3' | 'h4'; state: { issues: ValidationIssue[]; submits: number; failure: string | null; pending: boolean }
  formRef: React.RefObject<HTMLFormElement | null>; onSubmit: (event: FormEvent) => void; children: ReactNode; saveLabel: string; cancelLabel: string; onCancel: () => void; name: string
}) {
  const { t } = useCopy()
  return <FormSection title={title} description={description} actions={null} headingLevel={headingLevel} divided={false} labels={{ title, description }} className="min-w-0">
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-label={name} className="min-w-0 space-y-4">
      {state.failure && <Callout message={state.failure} />}
      {state.issues.length > 0 && <ValidationSummary errors={state.issues} submitCount={state.submits} title={t('validation.title')} labels={{ title: () => t('validation.title') }} className="" />}
      {children}
      <StickyActionBar dirty={true} saving={state.pending} onSave={() => formRef.current?.requestSubmit()} onCancel={onCancel} dirtyMessage={t('form.pending')} cleanMessage={t('form.pending')}
        saveLabel={saveLabel} cancelLabel={cancelLabel} hideWhenClean={false} aria-label={name} className="min-w-0" />
    </form>
  </FormSection>
}

export function ApplicationFormView({ existing, onSubmit, onCancel }: { existing: Application | null; onSubmit: Submit<ApplicationForm>; onCancel: () => void }) {
  const { t } = useCopy()
  const base = `auth-app${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const ids = { displayName: `${base}-name`, slug: `${base}-slug`, redirectUris: `${base}-redirects`, logoutUrl: `${base}-logout`, scopes: `${base}-scopes` }
  const labels = { displayName: t('app.displayName'), slug: t('app.slug'), redirectUris: t('app.redirectUris'), logoutUrl: t('app.logoutUrl') }
  const formRef = useRef<HTMLFormElement>(null)
  const s = useFormState(existing ? toApplicationForm(existing) : EMPTY_APPLICATION, validateApplication, ids, labels, onSubmit)
  const title = existing ? t('app.editTitle', { name: existing.displayName }) : t('app.createTitle')
  return <Frame title={title} description={t('app.formHelp')} headingLevel="h3" state={s} formRef={formRef} onSubmit={s.onSubmit} name={title}
    saveLabel={s.pending ? t('form.saving') : existing ? t('app.save') : t('app.create')} cancelLabel={t('form.cancel')} onCancel={onCancel}>
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      <TextField id={ids.displayName} label={labels.displayName} value={s.form.displayName} onChange={(value) => s.set('displayName', value)} error={s.message('displayName')} required={true} />
      <TextField id={ids.slug} label={labels.slug} value={s.form.slug} onChange={(value) => s.set('slug', value)} error={s.message('slug')} disabled={Boolean(existing)} required={true} />
      <Choice label={t('app.protocol')} value={s.form.protocol} onChange={(value) => s.set('protocol', value)} items={[{ value: 'oidc', label: t('enums.oidc') }, { value: 'saml', label: t('enums.saml') }, { value: 'api_key', label: t('enums.api_key') }]} />
      <TextField id={ids.logoutUrl} label={labels.logoutUrl} value={s.form.logoutUrl} onChange={(value) => s.set('logoutUrl', value)} error={s.message('logoutUrl')} />
    </div>
    <AreaField id={ids.redirectUris} label={labels.redirectUris} value={s.form.redirectUris} onChange={(value) => s.set('redirectUris', value)} error={s.message('redirectUris')} rows={3} />
    <TextField id={ids.scopes} label={t('app.scopes')} value={s.form.scopes} onChange={(value) => s.set('scopes', value)} />
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm font-medium text-foreground">{t('app.flows')}</legend>
      <div className="grid gap-2 md:grid-cols-2">
        {FLOWS.map((flow) => <Checkbox key={flow} label={t(`flows.${flow}`)} checked={s.form.authenticationFlows.includes(flow)}
          onCheckedChange={(next) => s.set('authenticationFlows', next === true ? [...s.form.authenticationFlows, flow] : s.form.authenticationFlows.filter((item) => item !== flow))} />)}
      </div>
    </fieldset>
  </Frame>
}

export function ProviderFormView({ existing, onSubmit, onCancel }: { existing: Provider | null; onSubmit: Submit<ProviderForm>; onCancel: () => void }) {
  const { t } = useCopy()
  const base = `auth-provider${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const ids = Object.fromEntries(['providerId', 'alias', 'displayName', 'metadataUrl', 'metadataXml', 'authorizationUrl', 'tokenUrl', 'userInfoUrl', 'entityId', 'ssoServiceUrl', 'sloServiceUrl'].map((field) => [field, `${base}-${field}`]))
  const labels: Record<string, string> = {
    providerId: t('provider.providerId'), alias: t('provider.alias'), displayName: t('provider.displayName'), metadataUrl: t('provider.metadataUrl'), metadataXml: t('provider.metadataXml'),
    authorizationUrl: t('provider.authorizationUrl'), tokenUrl: t('provider.tokenUrl'), userInfoUrl: t('provider.userInfoUrl'), entityId: t('provider.entityId'), ssoServiceUrl: t('provider.ssoServiceUrl'), sloServiceUrl: t('provider.sloServiceUrl'),
  }
  const formRef = useRef<HTMLFormElement>(null)
  const s = useFormState(existing ? toProviderForm(existing) : EMPTY_PROVIDER, validateProvider, ids, labels, onSubmit)
  const text = (field: keyof ProviderForm & string, extra: { disabled?: boolean; required?: boolean } = {}) =>
    <TextField id={ids[field]} label={labels[field]} value={String(s.form[field])} onChange={(value) => s.set(field, value as never)} error={s.message(field)} {...extra} />
  const title = existing ? t('provider.editTitle', { id: existing.providerId }) : t('provider.addTitle')
  const manual = s.form.providerMode === 'manual_endpoints'
  return <Frame title={title} description={t('provider.formHelp')} headingLevel="h4" state={s} formRef={formRef} onSubmit={s.onSubmit} name={title}
    saveLabel={s.pending ? t('form.saving') : existing ? t('provider.save') : t('provider.create')} cancelLabel={t('provider.reset')} onCancel={onCancel}>
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      {text('providerId', { disabled: Boolean(existing), required: true })}
      {text('alias', { required: true })}
      {text('displayName', { required: true })}
      <Choice label={t('provider.protocol')} value={s.form.protocol} onChange={(value) => s.set('protocol', value)} items={[{ value: 'oidc', label: t('enums.oidc') }, { value: 'saml', label: t('enums.saml') }]} />
      <Choice<ProviderMode> label={t('provider.mode')} value={s.form.providerMode} onChange={(value) => s.set('providerMode', value)}
        items={(['manual_endpoints', 'metadata_url', 'inline_metadata'] as const).map((value) => ({ value, label: t(`enums.${value}`) }))} />
      <Checkbox label={t('provider.enabled')} checked={s.form.enabled} onCheckedChange={(next) => s.set('enabled', next === true)} />
    </div>
    {s.form.providerMode === 'metadata_url' && text('metadataUrl', { required: true })}
    {s.form.protocol === 'oidc' && manual && <div className="grid min-w-0 gap-4 md:grid-cols-2">
      {text('authorizationUrl', { required: true })}{text('tokenUrl', { required: true })}{text('userInfoUrl')}
      <TextField id={`${base}-requestedScopes`} label={t('provider.requestedScopes')} value={s.form.requestedScopes} onChange={(value) => s.set('requestedScopes', value)} />
    </div>}
    {s.form.protocol === 'saml' && manual && <div className="grid min-w-0 gap-4 md:grid-cols-2">
      {text('entityId', { required: true })}
      <TextField id={`${base}-issuer`} label={t('provider.issuer')} value={s.form.issuer} onChange={(value) => s.set('issuer', value)} />
      {text('ssoServiceUrl', { required: true })}{text('sloServiceUrl')}
    </div>}
    {s.form.providerMode === 'inline_metadata' && <AreaField id={ids.metadataXml} label={labels.metadataXml} value={s.form.metadataXml} onChange={(value) => s.set('metadataXml', value)} error={s.message('metadataXml')} rows={5} />}
  </Frame>
}
