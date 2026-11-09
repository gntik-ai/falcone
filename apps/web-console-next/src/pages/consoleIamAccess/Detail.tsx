import { useState } from 'react'
import { EnableIcon, RemoveIcon, SuspendIcon, TrashIcon } from './icons'
import { Badge, Button, SimpleSelect, StatusTag, Tabs, TabsList, TabsPanel, TabsTab, Text } from '@gntik-ai/ui'
import { DescriptionListCard, SectionHeader, StatusTimeline } from '@gntik-ai/blocks'
import { ActionButton, Empty, Failed, Loading, NotFound } from './States'
import { focusRing, useCopy } from './copy'
import { isDefaultRole, isSuspended, roleNameOf, userIdOf, type IamGroup, type IamRole, type IamUser } from './api'
import type { DetailState } from './useIamAccess'

interface Props {
  user: IamUser | null
  detail: DetailState | null
  busy: boolean
  allRoles: IamRole[]
  allGroups: IamGroup[]
  onStatus: (user: IamUser, enabled: boolean, focusKey: string) => void
  onDelete: (user: IamUser, opener: HTMLElement) => void
  onRemoveRole: (user: IamUser, roleName: string, opener: HTMLElement) => void
  onRemoveGroup: (user: IamUser, group: IamGroup, opener: HTMLElement) => void
  onAssignRole: (roleName: string) => void
  onAddGroup: (group: IamGroup) => void
  onRetry: () => void
  onBack: () => void
}

function Header({ title }: { title: string }) {
  return <SectionHeader title={title} description={undefined} count={undefined} actions={[]} as="h2" headingId="iam-user-detail-heading" bordered={false} className="min-w-0" />
}

export function Detail({ user, detail, busy, allRoles, allGroups, onStatus, onDelete, onRemoveRole, onRemoveGroup, onAssignRole, onAddGroup, onRetry, onBack }: Props) {
  const { t } = useCopy()
  const [tab, setTab] = useState('summary')
  if (!user) {
    return <section aria-labelledby="iam-user-detail-heading" className="min-w-0 space-y-4">
      <Header title={t('detail.headingEmpty')} />
      <Empty title={t('detail.empty.title')} description={t('detail.empty.description')} titleAs="h3" />
    </section>
  }
  const id = userIdOf(user), suspended = isSuspended(user), statusKey = `status-user-detail-${id}`
  const heading = <Header title={t('detail.heading', { name: user.username })} />
  if (!detail || detail.userId !== id || detail.status === 'loading') {
    return <section aria-labelledby="iam-user-detail-heading" className="min-w-0 space-y-4">{heading}<Loading title={t('detail.loading.title')} description={t('detail.loading.description')} /></section>
  }
  if (detail.status === 'not-found') {
    return <section aria-labelledby="iam-user-detail-heading" className="min-w-0 space-y-4">{heading}
      <NotFound title={t('detail.notFound.title')} description={t('detail.notFound.description')} action={<ActionButton onClick={onBack}>{t('detail.notFound.action')}</ActionButton>} /></section>
  }
  if (detail.status === 'error') {
    return <section aria-labelledby="iam-user-detail-heading" className="min-w-0 space-y-4">{heading}
      <Failed title={t('detail.error.title')} failure={detail.failure ?? {}} retryLabel={t('detail.error.retry')} retry={onRetry} fallback="detail" /></section>
  }

  const assignedRoles = new Set(detail.roles.map(roleNameOf).filter(Boolean))
  const assignedGroups = new Set(detail.groups.map((group) => group.id))
  const assignableRoles = allRoles.map(roleNameOf).filter((name) => name && !assignedRoles.has(name) && !isDefaultRole(name))
  const assignableGroups = allGroups.filter((group) => !assignedGroups.has(group.id))
  const statusTag = <StatusTag status={suspended ? 'suspended' : 'active'} label={t(suspended ? 'users.suspended' : 'users.active')} statuses={{ active: { label: t('users.active'), tone: 'success' }, suspended: { label: t('users.suspended'), tone: 'neutral' } }} variant="soft" size="sm" shape="rounded" uppercase={false} />

  return <section aria-labelledby="iam-user-detail-heading" className="min-w-0 space-y-4">
    {heading}
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {statusTag}
      <Button type="button" variant="secondary" size="md" iconOnly={false} icon={suspended ? EnableIcon : SuspendIcon} trailingIcon={undefined} loading={false} data-focus-key={statusKey} disabled={busy} className={focusRing} onClick={() => onStatus(user, suspended, statusKey)}>{t(suspended ? 'detail.enable' : 'detail.suspend')}</Button>
      <Button type="button" variant="destructive" size="md" iconOnly={false} icon={TrashIcon} trailingIcon={undefined} loading={false} data-focus-key={`delete-user-${id}`} disabled={busy} className={focusRing} onClick={(event) => onDelete(user, event.currentTarget)}>{t('detail.delete')}</Button>
    </div>
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} variant="underline" className="min-w-0">
      <TabsList aria-label={t('detail.tabs')} indicator={true} fullWidth={false} className="max-w-full overflow-x-auto">
        <TabsTab value="summary" icon={undefined} count={undefined}>{t('detail.tab.summary')}</TabsTab>
        <TabsTab value="roles" icon={undefined} count={undefined}>{t('detail.tab.roles')}</TabsTab>
        <TabsTab value="groups" icon={undefined} count={undefined}>{t('detail.tab.groups')}</TabsTab>
      </TabsList>
      <TabsPanel value="summary" className="min-w-0 space-y-6 pt-4">
        <DescriptionListCard title={t('detail.summary.title')} description={undefined} wrap={true} columns={1} onEdit={undefined} editLabel={undefined} onCopy={undefined} titleAs="h3" className="min-w-0"
          labels={{ title: t('detail.summary.title'), description: '', edit: '', copy: (label: string) => t('detail.summary.copy', { label }), copied: (label: string) => t('detail.summary.copied', { label }), copiedToClipboard: t('detail.summary.copiedToClipboard') }}
          items={[
            { id: 'username', label: t('detail.summary.username'), value: user.username },
            { id: 'email', label: t('detail.summary.email'), value: user.email ?? t('users.noEmail') },
            { id: 'id', label: t('detail.summary.id'), value: id, mono: true, copyable: true },
            { id: 'status', label: t('detail.summary.status'), render: statusTag },
          ]} />
        <div className="min-w-0 space-y-3">
          <SectionHeader title={t('detail.summary.history')} description={undefined} count={undefined} actions={[]} as="h3" headingId={undefined} bordered={false} className="min-w-0" />
          <StatusTimeline events={[]} label={t('detail.summary.history')} emptyLabel={t('detail.summary.historyEmpty')} showFewerLabel={t('detail.summary.showFewer')} showEarlierLabel={(count: number) => t('detail.summary.showEarlier', { count })} actorLabel={t('detail.summary.actor')} maxVisible={undefined} timeFormat="relative" className="min-w-0" />
          <Text as="p" variant="body" tone="muted">{t('detail.summary.historyNote')}</Text>
        </div>
      </TabsPanel>
      <TabsPanel value="roles" className="min-w-0 space-y-4 pt-4">
        <SectionHeader title={t('detail.roles.heading')} description={undefined} count={undefined} actions={[]} as="h3" headingId={undefined} bordered={false} className="min-w-0" />
        <div className="flex min-w-0 flex-wrap gap-2">
          {detail.roles.length === 0 && <Text as="span" variant="body" tone="muted">{t('detail.roles.none')}</Text>}
          {detail.roles.map((role) => {
            const name = roleNameOf(role)
            return <Badge key={name} tone="neutral" variant="outline" size="md" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className="max-w-full gap-1 whitespace-normal break-all">
              {name}
              {!isDefaultRole(name) && <Button type="button" variant="ghost" size="sm" iconOnly={true} icon={RemoveIcon} trailingIcon={undefined} loading={false} data-focus-key={`remove-role-${name}`} disabled={busy} aria-label={t('detail.roles.removeNamed', { name })} className={focusRing} onClick={(event) => onRemoveRole(user, name, event.currentTarget)} />}
            </Badge>
          })}
        </div>
        <SimpleSelect value="" onValueChange={(value) => { if (value) onAssignRole(value) }} label={t('detail.roles.assign')} placeholder={t(assignableRoles.length ? 'detail.roles.placeholder' : 'detail.roles.unavailable')} size="md" disabled={busy || assignableRoles.length === 0}
          clearable={false} clearLabel="" onClear={undefined} loadOptions={undefined} className={`w-full min-w-0 ${focusRing}`} triggerRef={(element: HTMLButtonElement | null) => { element?.setAttribute('data-focus-key', 'assign-role') }} items={assignableRoles.map((value) => ({ value, label: value }))} />
      </TabsPanel>
      <TabsPanel value="groups" className="min-w-0 space-y-4 pt-4">
        <SectionHeader title={t('detail.groups.heading')} description={undefined} count={undefined} actions={[]} as="h3" headingId={undefined} bordered={false} className="min-w-0" />
        <div className="flex min-w-0 flex-wrap gap-2">
          {detail.groups.length === 0 && <Text as="span" variant="body" tone="muted">{t('detail.groups.none')}</Text>}
          {detail.groups.map((group) => <Badge key={group.id} tone="neutral" variant="outline" size="md" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className="max-w-full gap-1 whitespace-normal break-all">
            {group.name}
            <Button type="button" variant="ghost" size="sm" iconOnly={true} icon={RemoveIcon} trailingIcon={undefined} loading={false} data-focus-key={`remove-group-${group.id}`} disabled={busy} aria-label={t('detail.groups.removeNamed', { name: group.name })} className={focusRing} onClick={(event) => onRemoveGroup(user, group, event.currentTarget)} />
          </Badge>)}
        </div>
        <SimpleSelect value="" onValueChange={(value) => { const group = assignableGroups.find((entry) => entry.id === value); if (group) onAddGroup(group) }} label={t('detail.groups.assign')} placeholder={t(assignableGroups.length ? 'detail.groups.placeholder' : 'detail.groups.unavailable')} size="md" disabled={busy || assignableGroups.length === 0}
          clearable={false} clearLabel="" onClear={undefined} loadOptions={undefined} className={`w-full min-w-0 ${focusRing}`} triggerRef={(element: HTMLButtonElement | null) => { element?.setAttribute('data-focus-key', 'assign-group') }} items={assignableGroups.map((group) => ({ value: group.id, label: group.name }))} />
      </TabsPanel>
    </Tabs>
  </section>
}
