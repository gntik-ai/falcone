import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldDescription, FieldLabel, Input, PasswordInput, SimpleSelect, Text, useAnnounce } from '@gntik-ai/ui'
import { InlineCallout, ValidationSummary, type ValidationIssue } from '@gntik-ai/blocks'
import { SOCIAL_PROVIDER_TEMPLATES, upsertTenantIdentityProvider, type TenantIdentityProvider } from '@in-falcone/console-api/auth-config'
import { ALIAS_PATTERN, LIMITS, describeFailure } from './model'

const NAMESPACE = 'pages.console-auth-config-page'

interface Props {
  tenantId: string
  provider: TenantIdentityProvider | null
  aliases: string[]
  // Where focus goes when the dialog closes: the control that opened it.
  returnFocus: () => HTMLElement | null
  onClose: () => void
  onSaved: (providers: TenantIdentityProvider[]) => void
}

export function ProviderDialog({ tenantId, provider, aliases, returnFocus, onClose, onSaved }: Props) {
  const { t } = useTranslation(NAMESPACE)
  const announce = useAnnounce()
  const base = useRef(`auth-config-provider-${Math.random().toString(36).slice(2, 8)}`).current
  const ids = { template: `${base}-template`, alias: `${base}-alias`, name: `${base}-name`, clientId: `${base}-client-id`, secret: `${base}-secret`, scope: `${base}-scope` }
  const [open, setOpen] = useState(true)
  const [providerId, setProviderId] = useState(provider?.providerId ?? 'google')
  const [alias, setAlias] = useState(provider?.alias ?? 'google')
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '')
  const [clientId, setClientId] = useState(provider?.clientId ?? '')
  const [defaultScope, setDefaultScope] = useState(provider?.defaultScope ?? '')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [submits, setSubmits] = useState(0)
  // Bumped on submit to remount the password input: the kit component mirrors its value in internal state,
  // so clearing the DOM value alone would leave the submitted secret in memory after a failed save.
  const [secretEpoch, setSecretEpoch] = useState(0)
  // The secret is write-only: it lives in the uncontrolled input only, never in state or storage,
  // and the input is emptied before the request leaves.
  const secret = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const editing = provider !== null
  const duplicate = !editing && aliases.includes(alias)
  const invalid = (id: string) => issues.some((issue) => issue.fieldId === id)

  function validate(): ValidationIssue[] {
    const found: ValidationIssue[] = []
    if (!editing && !ALIAS_PATTERN.test(alias)) found.push({ fieldId: ids.alias, label: t('fieldAlias'), message: t('validationAlias') })
    if (!clientId) found.push({ fieldId: ids.clientId, label: t('fieldClientId'), message: t('validationClientId') })
    if (!editing && !(secret.current?.value ?? '')) found.push({ fieldId: ids.secret, label: t('fieldSecret'), message: t('validationSecret') })
    return found
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || duplicate) return
    const found = validate()
    setIssues(found); setSubmits((count) => count + 1)
    if (found.length) return
    const clientSecret = secret.current?.value ?? ''
    setSecretEpoch((epoch) => epoch + 1)
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const result = await upsertTenantIdentityProvider(tenantId, alias, {
        providerId, displayName, enabled,
        config: { clientId, defaultScope, ...(clientSecret ? { clientSecret } : {}) },
      })
      onSaved(result.identityProviders)
      setOpen(false)
    } catch (cause) {
      const message = describeFailure(t, cause, t('providerSaveFailed'))
      setError(message); announce(message, 'assertive')
    } finally { inFlight.current = false; setBusy(false) }
  }

  const close = () => { if (!inFlight.current) setOpen(false) }
  const text = (id: string, label: string, value: string, set: (value: string) => void, max: number, extra: { required?: boolean; disabled?: boolean; description?: string } = {}) =>
    <Field invalid={invalid(id)} className="min-w-0">
      <FieldLabel htmlFor={id} required={extra.required}>{label}</FieldLabel>
      <Input id={id} value={value} onValueChange={(next) => set(String(next))} maxLength={max} disabled={busy || extra.disabled} autoComplete="off" spellCheck={false} invalid={invalid(id)} className="w-full min-w-0" />
      {extra.description && <FieldDescription>{extra.description}</FieldDescription>}
    </Field>

  return <Dialog open={open} modal={true} disablePointerDismissal={busy}
    onOpenChange={(next, details) => { if (!next && inFlight.current) { details.cancel(); return } setOpen(next) }}
    onOpenChangeComplete={(next) => { if (!next) onClose() }}>
    <DialogContent size="md" presentation="responsive" showClose={false} closeLabel={t('close')} finalFocus={() => returnFocus() ?? true} className="min-w-0 max-w-full wrap-anywhere">
      <DialogHeader>
        <DialogTitle>{t(editing ? 'dialogEditTitle' : 'dialogCreateTitle')}</DialogTitle>
        <DialogDescription>{t('dialogDescription')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4">
          {error && <InlineCallout tone="destructive" title={t('dialogErrorTitle')} description={error} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
            labels={{ title: t('dialogErrorTitle'), description: error, upgrade: '', viewUsage: '' }} />}
          {duplicate && <InlineCallout tone="destructive" title={t('duplicateAlias')} description={undefined} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
            labels={{ title: t('duplicateAlias'), description: '', upgrade: '', viewUsage: '' }} />}
          {issues.length > 0 && <ValidationSummary errors={issues} submitCount={submits} title={t('validationTitle')} labels={{ title: () => t('validationTitle') }} className="" />}
          <Field invalid={false} className="min-w-0">
            <FieldLabel htmlFor={ids.template}>{t('fieldTemplate')}</FieldLabel>
            <SimpleSelect id={ids.template} value={providerId} defaultValue="google" placeholder={undefined} clearable={false} size="md" disabled={editing || busy} className="w-full min-w-0"
              items={SOCIAL_PROVIDER_TEMPLATES.map((template) => ({ value: template.id, label: template.label }))}
              onValueChange={(value) => { if (value) { setProviderId(value); setAlias(value) } }} />
          </Field>
          {text(ids.alias, t('fieldAlias'), alias, setAlias, LIMITS.alias, { required: !editing, disabled: editing, description: t('fieldAliasHelp') })}
          {text(ids.name, t('fieldName'), displayName, setDisplayName, LIMITS.displayName)}
          {text(ids.clientId, t('fieldClientId'), clientId, setClientId, LIMITS.clientId, { required: true })}
          <Field invalid={invalid(ids.secret)} className="min-w-0">
            <FieldLabel htmlFor={ids.secret} required={!editing}>{t('fieldSecret')}</FieldLabel>
            <PasswordInput key={secretEpoch} id={ids.secret} ref={secret} autoComplete="new-password" maxLength={LIMITS.clientSecret} disabled={busy} invalid={invalid(ids.secret)} showStrength={false}
              showLabel={t('showSecret')} hideLabel={t('hideSecret')} aria-describedby={`${ids.secret}-help`} spellCheck={false} className="w-full min-w-0" wrapperClassName="min-w-0" />
            <Text id={`${ids.secret}-help`} variant="supporting" tone="muted">{t(provider?.clientSecretSet ? 'fieldSecretSetHelp' : 'fieldSecretNewHelp')}</Text>
          </Field>
          {text(ids.scope, t('fieldScope'), defaultScope, setDefaultScope, LIMITS.defaultScope)}
          <Checkbox label={t('fieldEnabled')} checked={enabled} disabled={busy} onCheckedChange={(next) => setEnabled(next === true)} />
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t('cancel')}</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={busy || duplicate}>{t(busy ? 'dialogSaving' : 'dialogSave')}</Button>
          </DialogFooter>
        </form>
      </DialogBody>
    </DialogContent>
  </Dialog>
}
