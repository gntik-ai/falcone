import { useEffect, useRef, type ReactNode } from 'react'
import { Text, useAnnounce } from '@gntik-ai/ui'
import type { CursorList } from './useRemote'
import { useCopy } from './copy'
import { Action, FailureView, retryButton } from './States'

// Loaded count, Cargar más and the failed-page panel shared by every cursor-paged list.
// After a page lands the focus stays on Cargar más, or moves to the first appended row once the button is gone.
export function PagedBody<T>({ list, name, children }: { list: CursorList<T>; name: string; children: ReactNode }) {
  const { t } = useCopy(), announce = useAnnounce()
  const box = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null)
  const pending = useRef<{ before: number } | null>(null), retried = useRef(false)
  const count = list.items.length
  useEffect(() => {
    if (!pending.current || list.moreBusy) return
    const { before } = pending.current
    pending.current = null
    if (list.moreError) {
      if (retried.current) retryButton(box.current, t('retry'))?.focus()
      return
    }
    announce(t('appended', { count: count - before, section: t(name) }), 'polite')
    const target = button.current?.isConnected ? button.current : box.current?.querySelectorAll<HTMLElement>('[data-mongo-row]')[before]
    target?.focus()
  }, [list.moreBusy, list.moreError])
  const more = (retry: boolean) => { retried.current = retry; pending.current = { before: count }; void list.more() }
  return <div ref={box} className="min-w-0 space-y-4">
    {children}
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <Text as="p" variant="supporting" tone="muted">{t('loaded', { count })}</Text>
      {list.cursor !== null && !list.moreError && <Action ref={button} busy={list.moreBusy} onClick={() => more(false)}>{t(list.moreBusy ? 'loadingMore' : 'loadMore')}</Action>}
    </div>
    {list.moreError && <FailureView section="more" title={t(name === 'documents' ? 'errors.moreDocuments' : 'errors.more')} error={list.moreError} retry={() => more(true)} />}
  </div>
}
