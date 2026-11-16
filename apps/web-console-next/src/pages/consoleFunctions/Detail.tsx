import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, Tabs, TabsList, TabsPanel, TabsTab } from '@gntik-ai/ui'
import { ActivationsTab } from './ActivationsTab'
import { DeleteConfirm } from './DeleteConfirm'
import { DeployTab } from './DeployTab'
import { DetailTab } from './DetailTab'
import { INVENTORY_TITLE_ID } from './Inventory'
import { InvokeTab } from './InvokeTab'
import { Empty, FunctionStatus, WriteBlocked } from './States'
import { TriggersTab } from './TriggersTab'
import { focusRing, formatEnumLabel, useCopy } from './copy'
import { TABS, type Fn, type Tab } from './useFunctions'
import { VersionsTab, WRITE_REASON_ID } from './VersionsTab'

export function Detail({ s }: { s: Fn }) {
  const { t } = useCopy()
  const trigger = useRef<HTMLButtonElement>(null)
  if (!s.selectedId && s.mode !== 'create') {
    return <section aria-label={t('detail.emptyTitle')} className="min-w-0" data-testid="functions-detail-empty">
      <EmptyState icon={undefined} title={t('detail.emptyTitle')} description={t('detail.empty')} titleAs="h2" bordered={true} size="md" primaryAction={null} secondaryAction={null} className="min-w-0" />
    </section>
  }
  const action = s.effective
  const creating = s.mode === 'create' && !s.selectedId
  const title = creating ? t('detail.newFunction') : action?.actionName ?? t('detail.selected')
  const state = action?.provisioning?.state ?? action?.status
  const reason = s.writeReason
  const deleting = s.deleteOp.busy
  const idle = !s.selectedId ? <Empty title={t('detail.empty')} /> : null
  const panels: Record<Tab, JSX.Element> = {
    detail: idle ?? <DetailTab s={s} />,
    versions: idle ?? <VersionsTab s={s} />,
    activations: idle ?? <ActivationsTab s={s} />,
    triggers: idle ?? <TriggersTab action={s.detail.data} />,
    invoke: <InvokeTab s={s} />,
    deploy: <DeployTab s={s} />,
  }
  return <section aria-label={title} className="min-w-0 space-y-4" data-testid="functions-detail-pane">
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="min-w-0 break-words text-lg font-semibold text-foreground">{title}</h2>
        {action && <FunctionStatus value={state} />}
        {action?.provisioning?.state && <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className="max-w-full">{t('detail.provisioning', { state: formatEnumLabel(action.provisioning.state) })}</Badge>}
      </div>
      {action && s.selectedId && <Button ref={trigger} type="button" variant="destructive" size="sm" loading={false} disabled={s.writeBlocked || deleting} iconOnly={false} icon={Trash2 as never} trailingIcon={undefined}
        aria-busy={deleting} aria-describedby={reason ? WRITE_REASON_ID : undefined} aria-label={t(deleting ? 'delete.ariaBusy' : 'delete.aria', { name: action.actionName })} className={`w-full sm:w-auto ${focusRing}`} onClick={s.openDelete}>{deleting ? t('delete.busy') : t('delete.action')}</Button>}
    </div>
    {reason && <WriteBlocked id={WRITE_REASON_ID} reason={t(`write.${reason}`)} />}
    <Tabs value={s.tab} defaultValue={undefined} variant="underline" orientation="horizontal" onValueChange={(value) => s.changeTab(value as Tab)} className="min-w-0">
      <TabsList activateOnFocus={true} indicator={false} fullWidth={false} aria-label={t('detail.tabs')} className="flex max-w-full flex-nowrap overflow-x-auto">
        {TABS.map((tab) => <TabsTab key={tab} value={tab} icon={undefined} count={undefined} disabled={false} className={`shrink-0 ${focusRing}`}>{t(`tabs.${tab}`)}</TabsTab>)}
      </TabsList>
      {TABS.map((tab) => <TabsPanel key={tab} value={tab} keepMounted={false} className={`min-w-0 pt-4 ${focusRing}`}>{panels[tab]}</TabsPanel>)}
    </Tabs>
    <DeleteConfirm open={s.deleteOp.open} name={action?.actionName ?? ''} busy={deleting} failure={s.deleteOp.failure}
      finalFocus={() => (s.selectedId ? trigger.current : document.getElementById(INVENTORY_TITLE_ID)) ?? true} onConfirm={() => void s.confirmDelete()} onCancel={s.closeDelete} />
  </section>
}
