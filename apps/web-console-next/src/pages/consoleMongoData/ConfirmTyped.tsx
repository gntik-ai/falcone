import { useEffect, useId, useRef, useState } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldDescription, FieldLabel, Input, Text, useAnnounce } from '@gntik-ai/ui'
import { ErrorPanel } from '@gntik-ai/blocks'
import { failureOf, type Failure } from './api'
import { focusRing, useCopy } from './copy'
import { errorCopy } from './parts'

export interface ConfirmTypedProps {
  title: string
  description: string
  consequences: string[]
  expected: string
  confirmLabel: string
  // Where focus goes when the dialog is cancelled or dismissed.
  trigger: HTMLElement | null
  // Where focus goes after a successful confirm: a surviving row's Eliminar, else the documents toolbar.
  survivor: () => HTMLElement | null
  // Rejects when the request failed. The dialog then stays open with the error and the typed text, so confirming again retries.
  onConfirm: () => Promise<void>
  onClose: () => void
}

// Irreversible document delete: the confirm button stays disabled until the exact _id is typed. A failed request keeps
// the dialog open (error with request id announced assertively, typed id kept, focus inside); only success, Cancelar or Escape close it.
export function ConfirmTyped({ title, description, consequences, expected, confirmLabel, trigger, survivor, onConfirm, onClose }: ConfirmTypedProps) {
  const { t } = useCopy(), announce = useAnnounce()
  const [open, setOpen] = useState(true), [typed, setTyped] = useState(''), [pending, setPending] = useState(false), [failure, setFailure] = useState<Failure | null>(null)
  const input = useRef<HTMLInputElement>(null), confirmButton = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), inFlight = useRef(false), succeeded = useRef(false), id = useId()
  const mismatch = typed !== '' && typed !== expected
  async function confirm() {
    if (inFlight.current || typed !== expected) return
    inFlight.current = true; setPending(true); setFailure(null)
    try { await onConfirm(); succeeded.current = true; setOpen(false) }
    catch (cause) {
      const next = failureOf(cause); setFailure(next)
      announce(`${t('deleteConfirm.failedTitle')}. ${errorCopy(t, next)}`, 'assertive')
    } finally { inFlight.current = false; setPending(false) }
  }
  // A disabled button drops focus while the request runs; put it back inside the dialog once the error shows.
  useEffect(() => {
    if (!failure) return
    const frame = requestAnimationFrame(() => { if (!popup.current?.contains(document.activeElement)) confirmButton.current?.focus() })
    return () => cancelAnimationFrame(frame)
  }, [failure])
  return <AlertDialog open={open} onOpenChange={(next, event) => { if (!next && inFlight.current) { event.cancel(); return } setOpen(next) }} onOpenChangeComplete={(next) => { if (!next) onClose() }}>
    <AlertDialogContent ref={popup} size="md" container={undefined} initialFocus={() => input.current} finalFocus={() => succeeded.current ? survivor() ?? true : trigger?.isConnected ? trigger : true} className="min-w-0 max-w-full wrap-anywhere" data-testid="mongodata-confirm">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="mt-4 space-y-4">
        <ul className="list-disc space-y-1 ps-5">{consequences.map((line) => <li key={line}><Text as="span" variant="body" tone="muted">{line}</Text></li>)}</ul>
        <Field invalid={mismatch} disabled={pending} className="min-w-0">
          <FieldLabel htmlFor={`${id}-typed`}>{t('confirm.typeLabel', { text: expected })}</FieldLabel>
          <Input ref={input} id={`${id}-typed`} type="text" size="md" value={typed} disabled={pending} autoComplete="off" spellCheck={false} placeholder={expected} aria-describedby={`${id}-help`} aria-invalid={mismatch} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void confirm() } }} />
          <FieldDescription id={`${id}-help`} aria-live="polite">{t(mismatch ? 'confirm.mismatch' : 'confirm.instruction')}</FieldDescription>
        </Field>
        {failure && <div data-testid="mongodata-confirm-error" className="min-w-0"><ErrorPanel title={t('deleteConfirm.failedTitle')} message={errorCopy(t, failure)} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" onRetry={undefined} retrying={false} retryLabel="" secondaryAction={null} titleAs="h3" announce={false} className="min-w-0"
          labels={{ title: t('deleteConfirm.failedTitle'), message: errorCopy(t, failure), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} /></div>}
        <Text as="p" variant="body" tone="muted">{t('confirm.irreversible')}</Text>
      </div>
      <AlertDialogFooter className="mt-5 flex-wrap gap-2">
        <AlertDialogCancel disabled={pending} className={focusRing}>{t('cancel')}</AlertDialogCancel>
        <Button ref={confirmButton} type="button" variant="destructive" size="md" loading={pending} disabled={pending || typed !== expected} aria-busy={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => void confirm()}>{confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
