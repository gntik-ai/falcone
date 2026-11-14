import { useId, useRef, useState } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldDescription, FieldLabel, Input, Text } from '@gntik-ai/ui'
import { focusRing, useCopy } from './copy'

export interface ConfirmTypedProps {
  title: string
  description: string
  consequences: string[]
  expected: string
  confirmLabel: string
  trigger: HTMLElement | null
  // Resolves once the request settled. Failures are reported by the caller, so the dialog always closes afterwards.
  onConfirm: () => Promise<void>
  onClose: () => void
}

// Irreversible actions (row delete, key revoke): the confirm button stays disabled until the exact text is typed.
export function ConfirmTyped({ title, description, consequences, expected, confirmLabel, trigger, onConfirm, onClose }: ConfirmTypedProps) {
  const { t } = useCopy()
  const [open, setOpen] = useState(true), [typed, setTyped] = useState(''), [pending, setPending] = useState(false)
  const input = useRef<HTMLInputElement>(null), inFlight = useRef(false), id = useId()
  const mismatch = typed !== '' && typed !== expected
  async function confirm() {
    if (inFlight.current || typed !== expected) return
    inFlight.current = true; setPending(true)
    try { await onConfirm() } finally { inFlight.current = false; setPending(false); setOpen(false) }
  }
  return <AlertDialog open={open} onOpenChange={(next, event) => { if (!next && inFlight.current) { event.cancel(); return } setOpen(next) }} onOpenChangeComplete={(next) => { if (!next) onClose() }}>
    <AlertDialogContent size="md" container={undefined} initialFocus={() => input.current} finalFocus={() => trigger?.isConnected ? trigger : true} className="min-w-0 max-w-full wrap-anywhere" data-testid="pgdata-confirm">
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
        <Text as="p" variant="body" tone="muted">{t('confirm.irreversible')}</Text>
      </div>
      <AlertDialogFooter className="mt-5 flex-wrap gap-2">
        <AlertDialogCancel disabled={pending} className={focusRing}>{t('cancel')}</AlertDialogCancel>
        <Button type="button" variant="destructive" size="md" loading={pending} disabled={pending || typed !== expected} aria-busy={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => void confirm()}>{confirmLabel}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
