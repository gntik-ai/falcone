import type { ReactNode } from 'react'
import { Text } from '@gntik-ai/ui'
import type { DataTableColumn } from '@gntik-ai/blocks'
import { useCopy, focusRing } from './copy'
import { Action, Empty, FailureView, Heading, Loading, Table } from './States'
import type { Collection, Section } from './useSection'
export function Inventory<T extends object>({ state, kind, columns, id, emptyKey = kind, children = null, title }: { state: Section<Collection<T>>; kind: string; columns: DataTableColumn<T>[]; id: (row: T) => string; emptyKey?: string; children?: ReactNode; title?: string }) {
  const { t } = useCopy()
  const rows = state.data?.items ?? []
  return <section id={`pg-${state.path}`} tabIndex={-1} className={`min-w-0 space-y-4 ${focusRing}`} aria-label={t(kind)} aria-busy={state.busy}>
    <Heading title={title ?? t(kind)} description={t(`descriptions.${kind}`)} />
    {state.busy ? <Loading label={t(`loading.${kind}`)} /> : state.error ? <FailureView section={kind} error={state.error} retry={state.retry} /> : <>
      {rows.length ? <Table rows={rows} id={id} label={t(`tableLabels.${kind}`)} columns={columns} /> : <Empty title={t(`empty.${emptyKey}`)} />}
      {children}
    </>}
    {!state.busy && !state.error && <div className="flex min-w-0 flex-wrap items-center gap-3" aria-label={t('paging', { section: t(kind) })}>
      {state.previous && <Action onClick={state.back}>{t('previous')}</Action>}
      <Text as="p" variant="supporting" tone="muted">{t('shown', { count: rows.length })}</Text>
      {state.next && <Action onClick={state.forward}>{t('next')}</Action>}
    </div>}
  </section>
}
