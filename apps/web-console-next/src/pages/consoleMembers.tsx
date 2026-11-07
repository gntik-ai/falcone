import { useCallback, useRef, useState } from 'react'
import { Badge, I18nProvider, LiveAnnouncer, Page, SimpleTooltip } from '@gntik-ai/ui'
import { PageHeader, PageToolbar, type DataTableColumn } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { listUsers, listRoles, type IamRole, type IamUser } from './consoleMembers/api'
import { useCopy, focusRing, roleKey, reasonKey } from './consoleMembers/copy'
import { Action, Empty, Heading, ListFailure, Loading, Table } from './consoleMembers/ui'
import { useList } from './consoleMembers/useList'
import { CreateUser } from './consoleMembers/CreateUser'
import { Invitations } from './consoleMembers/Invitations'
import { InviteWizard } from './consoleMembers/InviteWizard'
import './consoleMembers/page.css'

function Chip({ children }: { children: string }) {
  return <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{children}</Badge>
}
function Directory({ tenantId, realmId, tenantLabel }: { tenantId: string; realmId: string; tenantLabel: string }) {
  const { t } = useCopy(), permissions = usePermissions(), context = useConsoleContext()
  const manage = permissions.can('tenant.members.manage')
  const [usersRevision, setUsersRevision] = useState(0), [rolesRevision, setRolesRevision] = useState(0), [invitationRevision, setInvitationRevision] = useState(0)
  const [createOpen, setCreateOpen] = useState(false), [inviteOpen, setInviteOpen] = useState(false)
  const inviteTrigger = useRef<HTMLButtonElement>(null), createTrigger = useRef<HTMLButtonElement>(null)
  const usersLoad = useCallback((signal: AbortSignal) => listUsers(realmId, signal), [realmId])
  const rolesLoad = useCallback((signal: AbortSignal) => listRoles(realmId, signal), [realmId])
  const users = useList(usersLoad, usersRevision), roles = useList(rolesLoad, rolesRevision)
  const userColumns: DataTableColumn<IamUser>[] = [
    { id: 'username', header: t('username'), sortable: false, cell: (user) => user.username },
    { id: 'email', header: t('email'), sortable: false, cell: (user) => user.email ?? t('unavailable') },
    { id: 'enabled', header: t('status'), sortable: false, cell: (user) => <Chip>{t(user.enabled ? 'active' : 'disabled')}</Chip> },
    { id: 'state', header: t('lifecycle'), sortable: false, cell: (user) => user.state ? t(`lifecycleStates.${user.state}`, { defaultValue: user.state }) : t('unavailable') },
    { id: 'roles', header: t('roles'), sortable: false, cell: (user) => user.realmRoles?.length ? <div className="flex flex-wrap gap-2">{user.realmRoles.map((role) => <Chip key={role}>{role}</Chip>)}</div> : t('noRoles') },
    { id: 'required', header: t('requiredActions'), sortable: false, cell: (user) => user.requiredActions?.length ? <div className="flex flex-wrap gap-2">{user.requiredActions.map((action) => <Chip key={action}>{action}</Chip>)}</div> : t('noActions') },
  ]
  const roleColumns: DataTableColumn<IamRole>[] = [
    { id: 'name', header: t('roleName'), sortable: false, cell: (role) => role.roleName },
    { id: 'description', header: t('description'), sortable: false, cell: (role) => role.description?.trim() || t('noDescription') },
    { id: 'type', header: t('type'), sortable: false, cell: (role) => <Chip>{t(role.composite ? 'composite' : 'simple')}</Chip> },
    { id: 'children', header: t('childRoles'), sortable: false, cell: (role) => role.composite && role.compositeRoles.length ? <div className="flex flex-wrap gap-2">{role.compositeRoles.map((child) => <Chip key={child}>{child}</Chip>)}</div> : t('noChildRoles') },
  ]
  function closeInvite() {
    setInviteOpen(false); setInvitationRevision((value) => value + 1)
    requestAnimationFrame(() => inviteTrigger.current?.focus())
  }
  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="console-members-page"
    header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('realmDescription', { realm: realmId })} breadcrumbs={[]} status="" statuses={{}} meta={[{ label: t('organization'), value: tenantLabel, icon: undefined, mono: false }, { label: t('realmMeta', { realm: '' }), value: realmId, icon: undefined, mono: true }]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('realmDescription', { realm: realmId }), moreActions: t('actions'), sections: t('actions') }} />}>
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('actions')} searchPlaceholder={t('actions')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('actions')} className="members-toolbar min-w-0" filters={manage ? <div className="flex flex-wrap gap-2"><Action ref={inviteTrigger} variant="primary" onClick={() => { setCreateOpen(false); setInviteOpen(true) }}>{t('invite')}</Action><Action ref={createTrigger} onClick={() => { setCreateOpen(!createOpen); if (createOpen) createTrigger.current?.focus() }}>{t(createOpen ? 'close' : 'create')}</Action></div> : <SimpleTooltip content={t(reasonKey(permissions.roles))} side="bottom"><Badge tone="warning" variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className={`max-w-full whitespace-normal text-left ${focusRing}`} tabIndex={0} aria-label={t('readOnly', { role: t(`roleLabels.${roleKey(permissions.roles)}`), reason: t(reasonKey(permissions.roles)) })}>{t('readOnly', { role: t(`roleLabels.${roleKey(permissions.roles)}`), reason: '' })}</Badge></SimpleTooltip>} />
    {manage && createOpen && <CreateUser tenantId={tenantId} roles={roles?.rows ?? []} onCreated={() => { setCreateOpen(false); setUsersRevision((value) => value + 1); requestAnimationFrame(() => createTrigger.current?.focus()) }} />}
    {manage && <Invitations tenantId={tenantId} reload={invitationRevision} />}
    <section aria-label={t('users')} className="min-w-0 space-y-4"><Heading title={t('users')} description={t('usersDescription')} />
      {users?.failure ? <ListFailure kind="users" failure={users.failure} retry={() => setUsersRevision((value) => value + 1)} /> : !users?.rows ? <Loading label={t('usersLoading')} /> : users.rows.length ? <Table rows={users.rows} columns={userColumns} id={(user) => user.userId} label={t('usersTable')} /> : <Empty title={t('usersEmpty')} />}
    </section>
    <section aria-label={t('roles')} className="min-w-0 space-y-4"><Heading title={t('roles')} description={t('rolesDescription')} />
      {roles?.failure ? <ListFailure kind="roles" failure={roles.failure} retry={() => setRolesRevision((value) => value + 1)} /> : !roles?.rows ? <Loading label={t('rolesLoading')} /> : roles.rows.length ? <Table rows={roles.rows} columns={roleColumns} id={(role) => role.roleName} label={t('rolesTable')} /> : <Empty title={t('rolesEmpty')} />}
    </section>
    {manage && inviteOpen && <InviteWizard key={context.activeWorkspaceId} tenantId={tenantId} workspaceId={context.activeWorkspaceId ?? ''} onClose={closeInvite} />}
  </Page>
}
export default function ConsoleMembersPage() {
  const { t, i18n: language } = useCopy(), context = useConsoleContext()
  const tenant = context.tenants.find((tenant) => tenant.tenantId === context.activeTenantId)
  const realm = tenant?.identityContext?.consoleUserRealm
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel') }}><LiveAnnouncer>
    {tenant && realm ? <Directory key={`${tenant.tenantId}:${realm}`} tenantId={tenant.tenantId} realmId={realm} tenantLabel={tenant.displayName} /> : <div data-testid="console-members-page"><h1 className="text-2xl font-semibold">{t('emptyTitle')}</h1><Empty title={t(tenant ? 'noRealm' : 'noTenant')} /></div>}
  </LiveAnnouncer></I18nProvider>
}
