import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Field, FieldLabel, PasswordInput, SimpleSelect, useAnnounce } from '@gntik-ai/ui'
import { FormSection } from '@gntik-ai/blocks'
import { createUser, failureOf, type IamRole } from './api'
import { useCopy, focusRing, reasonKey } from './copy'
import { Action, Control, Notice, failureKey } from './ui'
import { usePermissions } from '../../shell/permissions'

export function CreateUser({ tenantId, roles, onCreated }: { tenantId: string; roles: IamRole[]; onCreated: () => void }) {
  const { t } = useCopy(), permissions = usePermissions(), announce = useAnnounce()
  const [data, setData] = useState({ username: '', email: '', password: '', role: 'tenant_developer' })
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [denied, setDenied] = useState(false)
  const locked = useRef(false), active = useRef(true), username = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { active.current = true; username.current?.focus(); return () => { active.current = false } }, [])
  const assignable = roles.map((role) => role.roleName).filter((name) => name && !name.startsWith('default-roles'))
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (locked.current || !data.username.trim() || !data.password.trim()) return
    locked.current = true; setBusy(true); setError(''); setDenied(false)
    try {
      await createUser(tenantId, data)
      if (active.current) setData({ username: '', email: '', password: '', role: 'tenant_developer' })
      announce(t('created')); onCreated()
    } catch (cause) {
      if (active.current) {
        const failure = failureOf(cause)
        setDenied(failure.status === 403)
        setError(failure.status === 403 ? t(permissions.denyReason('tenant.members.manage') ? reasonKey(permissions.roles) : 'createDenied') : t(failureKey(failure, 'createFailure')))
      }
    } finally { locked.current = false; if (active.current) setBusy(false) }
  }
  return <FormSection title={t('create')} description={t('createHelp')} actions={null} headingLevel="h2" divided={false} labels={{ title: t('create'), description: t('createHelp') }} className="min-w-0">
    {error && <Notice message={denied ? t('restrictedAction') : error} description={denied ? error : null} />}
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field invalid={false}><FieldLabel required>{t('username')}</FieldLabel><Control ref={username} value={data.username} onValueChange={(username) => setData({ ...data, username })} placeholder={t('usernamePlaceholder')} required disabled={busy} /></Field>
      <Field invalid={false}><FieldLabel required={false}>{t('email')}</FieldLabel><Control type="email" value={data.email} onValueChange={(email) => setData({ ...data, email })} placeholder={t('emailPlaceholder')} disabled={busy} /></Field>
      <Field invalid={false}><FieldLabel required>{t('password')}</FieldLabel><PasswordInput value={data.password} onValueChange={(password) => setData({ ...data, password })} required disabled={busy} size="md" defaultVisible={false} onVisibleChange={undefined} showStrength={false} strength={undefined} strengthLabels={[t('strength0'), t('strength1'), t('strength2'), t('strength3'), t('strength4')]} strengthPrefix={t('strength')} showLabel={t('showPassword')} hideLabel={t('hidePassword')} placeholder={undefined} leadingIcon={undefined} leadingAddon={undefined} wrapperClassName="min-w-0" className={focusRing} /></Field>
      <SimpleSelect value={data.role} onValueChange={(role) => setData({ ...data, role: role ?? '' })} items={assignable.length ? assignable.map((value) => ({ value, label: value })) : [{ value: 'tenant_developer', label: t('tenantDeveloper') }]} label={t('initialRole')} placeholder={t('selectRole')} size="md" disabled={busy} clearable={false} clearLabel={t('clear')} onClear={undefined} loadOptions={undefined} loadingText={t('loading')} errorText={t('optionsFailure')} emptyText={t('empty')} className={focusRing} />
      <div className="sm:col-span-2"><Action type="submit" variant="primary" disabled={busy || !data.username.trim() || !data.password.trim()} loading={busy}>{t(busy ? 'creating' : 'create')}</Action></div>
    </form>
  </FormSection>
}
