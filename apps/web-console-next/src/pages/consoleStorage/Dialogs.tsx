import { useRef, useState } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@gntik-ai/ui'
import type { StorageState } from './useStorage'
import { Action, FailurePanel, TextField } from './States'
import { focus, focusRing, useCopy } from './copy'

// Documented confirm-destructive pattern, composed for translated prompts and local failure surfaces.
export function DeleteDialog({ state: s, opener }: { state: StorageState; opener: React.RefObject<HTMLElement | null> }) {
  const { t } = useCopy()
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const bucket = s.deleting!
  const pending = s.mutations.delete.busy
  const failure = s.mutations.delete.failure
  const exact = typed === bucket.bucketName
  const close = () => { s.setDeleting(null); s.dismiss('delete') }
  const send = () => { if (exact && !pending) void s.perform('delete', Boolean(failure)) }
  return <AlertDialog open={true} onOpenChange={(next, event) => { if (!next) { if (pending) event.cancel(); else close() } }}>
    <AlertDialogContent size="md" aria-modal="true" container={undefined} initialFocus={() => input.current ?? true} finalFocus={() => opener.current?.isConnected ? opener.current : (document.getElementById('storage-heading') ?? true)} className="min-w-0" data-testid="storage-delete-dialog">
      <AlertDialogHeader tone="destructive" icon={undefined}><AlertDialogTitle>{t('deleteTitle', { name: bucket.bucketName })}</AlertDialogTitle><AlertDialogDescription>{t('deleteImpact')}</AlertDialogDescription></AlertDialogHeader>
      <form className="mt-4 min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); if (!failure) send() }}>
        {failure && <FailurePanel section="delete" failure={failure} busy={pending} retryDisabled={!exact} retry={send} close={close} autoFocus={true} back={() => { close(); focus('storage-buckets-heading') }} backLabel={t('backBuckets')} />}
        <TextField id="storage-delete-name" label={t('typedName')} placeholder={bucket.bucketName} value={typed} onChange={setTyped} busy={pending} inputRef={input} />
        <AlertDialogFooter className="mt-4 flex-wrap gap-2"><AlertDialogCancel disabled={pending} className={focusRing}>{t('cancel')}</AlertDialogCancel>
          {!failure && <Action type="submit" variant="destructive" disabled={!exact} busy={pending}>{t(pending ? 'deleting' : 'delete')}</Action>}
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>
}
