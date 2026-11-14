import { useRef, useState } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@gntik-ai/ui'
import { focusRing, useCopy } from './copy'
import { Action, TextField } from './States'

export type Confirmation = { title: string; description: string; consequences: string[]; value: string; confirmLabel: string; opener: HTMLElement | null; testId: string; run: () => Promise<void> }

// The confirm-destructive pattern with translated copy: the confirm button stays disabled until the
// typed text equals `value`. Cancelar and Escape close it without a request; while the action runs
// the dialog refuses dismissal, and it closes when the action settles.
export function ConfirmDestructiveDialog({ confirmation, close }: { confirmation: Confirmation; close: () => void }) {
  const { t } = useCopy()
  const [typed, setTyped] = useState(''), [pending, setPending] = useState(false)
  const input = useRef<HTMLInputElement>(null), running = useRef(false)
  const exact = typed === confirmation.value
  async function send() {
    if (!exact || running.current) return
    running.current = true; setPending(true)
    try { await confirmation.run() } finally { running.current = false; setPending(false); close() }
  }
  return <AlertDialog open={true} onOpenChange={(next, event) => { if (!next) { if (pending) event.cancel(); else close() } }}>
    <AlertDialogContent size="md" aria-modal="true" container={undefined} initialFocus={() => input.current ?? true} finalFocus={() => confirmation.opener?.isConnected ? confirmation.opener : (document.getElementById('pgdata-heading') ?? true)} className="min-w-0 max-w-full wrap-anywhere" data-testid={confirmation.testId}>
      <AlertDialogHeader tone="destructive" icon={undefined}><AlertDialogTitle>{confirmation.title}</AlertDialogTitle><AlertDialogDescription>{confirmation.description}</AlertDialogDescription></AlertDialogHeader>
      <ul className="mt-4 list-disc space-y-1 ps-6 text-sm text-muted-foreground">{confirmation.consequences.map((item) => <li key={item}>{item}</li>)}</ul>
      <form className="mt-4 min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <TextField id="pgdata-confirm-input" label={t('typeToConfirm', { value: confirmation.value })} placeholder={confirmation.value} value={typed} onChange={setTyped} inputRef={input} disabled={pending} />
        <AlertDialogFooter className="mt-4 flex-wrap gap-2">
          <AlertDialogCancel disabled={pending} className={focusRing}>{t('cancel')}</AlertDialogCancel>
          <Action type="submit" variant="destructive" disabled={!exact} busy={pending}>{confirmation.confirmLabel}</Action>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>
}
