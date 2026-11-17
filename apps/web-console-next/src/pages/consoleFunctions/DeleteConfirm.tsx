import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldLabel, Input, Text } from '@gntik-ai/ui'
import type { Failure } from './api'
import { describeFailure, focusRing, useCopy } from './copy'
import { FailurePanel } from './States'

interface Props {
  open: boolean
  name: string
  busy: boolean
  failure: Failure | null
  finalFocus: () => HTMLElement | boolean
  onConfirm: () => void
  onCancel: () => void
}

// Typed confirmation for the delete (destructive-ops.ts:39, CRITICAL). It is composed from alert-dialog because the kit
// confirm-destructive block hard-codes an English typed-name prompt. Cancel and Escape send nothing; a failed attempt keeps
// the typed name so Reintentar resends the same request.
export function DeleteConfirm({ open, name, busy, failure, finalFocus, onConfirm, onCancel }: Props) {
  const { t } = useCopy()
  const id = useId()
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const matches = typed === name
  useLayoutEffect(() => { if (!open) setTyped('') }, [open, name])
  const send = () => { if (matches && !busy) onConfirm() }
  const submit = (event: FormEvent) => { event.preventDefault(); send() }
  return <AlertDialog open={open} onOpenChange={(next, event) => { if (next) return; if (busy) { event.cancel(); return } onCancel() }}>
    <AlertDialogContent size="md" aria-modal="true" container={undefined} initialFocus={() => input.current ?? true} finalFocus={finalFocus} className="min-w-0" data-testid="functions-delete-confirm">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{t('delete.dialogTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('delete.dialogDescription')}</AlertDialogDescription>
      </AlertDialogHeader>
      <form onSubmit={submit} noValidate className="mt-4 min-w-0 space-y-4">
        <div className="min-w-0 space-y-2">
          <Text as="p" variant="body" tone="default" className="break-words">{t('delete.line', { name })}</Text>
          <Text as="p" variant="body" tone="muted" className="break-words">{t('delete.impact')}</Text>
          <Text as="p" variant="body" tone="destructive">{t('delete.irreversible')}</Text>
        </div>
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={`${id}-typed`}>{t('delete.typed')}</FieldLabel>
          <Input ref={input} id={`${id}-typed`} data-fn-field="typed-name" type="text" size="md" value={typed} readOnly={busy} autoComplete="off" spellCheck={false} placeholder={name}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => setTyped(event.target.value)} />
        </Field>
        {failure && <FailurePanel section="delete" failure={failure} message={describeFailure(t, failure, 'delete')} retry={send} retrying={busy} canRetry={matches} />}
        <AlertDialogFooter className="mt-5 flex-wrap gap-2">
          <AlertDialogCancel disabled={busy} className={focusRing}>{t('delete.cancel')}</AlertDialogCancel>
          <Button type="submit" variant="destructive" size="md" loading={busy} disabled={busy || !matches} aria-busy={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing}>{busy ? t('delete.confirming') : t('delete.confirm')}</Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>
}
