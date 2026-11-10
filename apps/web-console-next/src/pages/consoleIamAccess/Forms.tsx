import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { AddIcon } from './icons'
import { Button, Field, FieldDescription, FieldLabel, Input, PasswordInput, SimpleSelect } from '@gntik-ai/ui'
import { FormSection } from '@gntik-ai/blocks'
import type { IamCreateUserInput } from '@in-falcone/console-api/iam'
import { focusRing, useCopy } from './copy'
import { isDefaultRole, roleNameOf, type IamRole } from './api'

interface UserDraft { username: string; email: string; password: string; role: string }
export interface FormDrafts {
  user: UserDraft
  setUser: Dispatch<SetStateAction<UserDraft>>
  roleName: string
  setRoleName: Dispatch<SetStateAction<string>>
  groupName: string
  setGroupName: Dispatch<SetStateAction<string>>
}
const emptyUser: UserDraft = { username: '', email: '', password: '', role: '' }
// The select has no clear button (its built-in one is under the 24px target); this item stands for no initial role.
const NO_ROLE = '__no-initial-role__'

// The unsent values live above the catalogue branches, so a failed inventory load and its retry never discard them.
export function useFormDrafts(): FormDrafts {
  const [user, setUser] = useState<UserDraft>(emptyUser)
  const [roleName, setRoleName] = useState('')
  const [groupName, setGroupName] = useState('')
  return { user, setUser, roleName, setRoleName, groupName, setGroupName }
}

interface Props {
  drafts: FormDrafts
  roles: IamRole[]
  busy: boolean
  onCreateUser: (input: IamCreateUserInput) => Promise<boolean>
  onCreateRole: (name: string) => Promise<boolean>
  onCreateGroup: (name: string) => Promise<boolean>
}

function Submit({ busy, disabled, label, variant }: { busy: boolean; disabled: boolean; label: string; variant: 'primary' | 'secondary' }) {
  const { t } = useCopy()
  return <Button type="submit" variant={variant} size="md" loading={false} disabled={disabled} iconOnly={false} icon={AddIcon} trailingIcon={undefined} className={focusRing}>{busy ? t('forms.creating') : label}</Button>
}

export function Forms({ drafts, roles, busy, onCreateUser, onCreateRole, onCreateGroup }: Props) {
  const { t } = useCopy()
  const { user, setUser, roleName, setRoleName, groupName, setGroupName } = drafts
  const roleOptions = roles.map(roleNameOf).filter((name) => name && !isDefaultRole(name))

  async function submitUser(event: FormEvent) {
    event.preventDefault()
    if (busy || !user.username.trim()) return
    const created = await onCreateUser({ username: user.username, email: user.email, temporaryPassword: user.password, role: user.role })
    if (created) setUser(emptyUser)
  }
  async function submitRole(event: FormEvent) {
    event.preventDefault()
    if (busy || !roleName.trim()) return
    if (await onCreateRole(roleName)) setRoleName('')
  }
  async function submitGroup(event: FormEvent) {
    event.preventDefault()
    if (busy || !groupName.trim()) return
    if (await onCreateGroup(groupName)) setGroupName('')
  }

  return <section aria-label={t('forms.label')} className="min-w-0 space-y-6">
    <FormSection title={t('forms.user.title')} description={t('forms.user.description')} actions={null} headingLevel="h2" divided={false} labels={{ title: t('forms.user.title'), description: t('forms.user.description') }} className="min-w-0">
      <form onSubmit={submitUser} className="grid min-w-0 gap-4" data-testid="iam-create-user-form">
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel required>{t('forms.user.username')}</FieldLabel>
          <Input data-focus-key="create-user-username" required size="md" value={user.username} onValueChange={(username) => setUser((current) => ({ ...current, username }))} autoComplete="username" placeholder={t('forms.user.usernamePlaceholder')} disabled={busy} invalid={false}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`min-w-0 ${focusRing}`} />
        </Field>
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel required={false}>{t('forms.user.email')}</FieldLabel>
          <Input type="email" size="md" value={user.email} onValueChange={(email) => setUser((current) => ({ ...current, email }))} autoComplete="email" placeholder={t('forms.user.emailPlaceholder')} disabled={busy} invalid={false}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`min-w-0 ${focusRing}`} />
          <FieldDescription>{t('forms.user.help')}</FieldDescription>
        </Field>
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel required={false}>{t('forms.user.password')}</FieldLabel>
          <PasswordInput size="md" value={user.password} onValueChange={(password) => setUser((current) => ({ ...current, password }))} autoComplete="new-password" disabled={busy} defaultVisible={false} onVisibleChange={undefined}
            showStrength={false} strength={undefined} showLabel={t('forms.user.showPassword')} hideLabel={t('forms.user.hidePassword')} className={`min-w-0 ${focusRing}`} />
        </Field>
        <SimpleSelect value={user.role || NO_ROLE} onValueChange={(role) => setUser((current) => ({ ...current, role: !role || role === NO_ROLE ? '' : role }))} label={t('forms.user.role')} placeholder={t('forms.user.noRole')} size="md" disabled={busy || roleOptions.length === 0}
          clearable={false} clearLabel={t('forms.user.noRole')} onClear={undefined} loadOptions={undefined} className={`w-full min-w-0 ${focusRing}`} items={[{ value: NO_ROLE, label: t('forms.user.noRole') }, ...roleOptions.map((value) => ({ value, label: value }))]} />
        <div><Submit busy={busy} disabled={busy || !user.username.trim()} label={t('forms.user.submit')} variant="primary" /></div>
      </form>
    </FormSection>
    <FormSection title={t('forms.role.title')} description={t('forms.role.description')} actions={null} headingLevel="h2" divided={true} labels={{ title: t('forms.role.title'), description: t('forms.role.description') }} className="min-w-0">
      <form onSubmit={submitRole} noValidate className="grid min-w-0 gap-4" data-testid="iam-create-role-form">
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel required>{t('forms.role.name')}</FieldLabel>
          <Input data-focus-key="create-role-name" required size="md" value={roleName} onValueChange={setRoleName} autoComplete="off" placeholder={t('forms.role.namePlaceholder')} disabled={busy} invalid={false}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`min-w-0 ${focusRing}`} />
        </Field>
        <div><Submit busy={busy} disabled={busy || !roleName.trim()} label={t('forms.role.submit')} variant="secondary" /></div>
      </form>
    </FormSection>
    <FormSection title={t('forms.group.title')} description={t('forms.group.description')} actions={null} headingLevel="h2" divided={true} labels={{ title: t('forms.group.title'), description: t('forms.group.description') }} className="min-w-0">
      <form onSubmit={submitGroup} noValidate className="grid min-w-0 gap-4" data-testid="iam-create-group-form">
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel required>{t('forms.group.name')}</FieldLabel>
          <Input data-focus-key="create-group-name" required size="md" value={groupName} onValueChange={setGroupName} autoComplete="off" placeholder={t('forms.group.namePlaceholder')} disabled={busy} invalid={false}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`min-w-0 ${focusRing}`} />
        </Field>
        <div><Submit busy={busy} disabled={busy || !groupName.trim()} label={t('forms.group.submit')} variant="secondary" /></div>
      </form>
    </FormSection>
  </section>
}
