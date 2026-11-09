import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldDescription, FieldLabel, Input, Text } from '@gntik-ai/ui'
import { focusRing, useCopy } from './copy'
import { findFocusTarget, type ConfirmState } from './useIamAccess'

interface Props {
  state: ConfirmState | null
  onConfirm: () => void
  onClose: () => void
  onClosed: () => void
}

// Typed confirmation for deleting a user and a plain confirmation for removing a role or group, both composed
// from alert-dialog: the kit confirm-destructive block hard-codes an English typed-name prompt. A failed confirm
// keeps the dialog open with the error, and the typed name survives it.
export function ConfirmDialog({ state, onConfirm, onClose, onClosed }: Props) {
  const { t } = useCopy()
  const id = useId()
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const request = state?.request
  const pending = state?.pending ?? false
  const error = state?.error ?? null
  const typedName = request?.kind === 'deleteUser' ? request.user.username : null
  const matches = typedName === null || typed === typedName
  const mismatch = typedName !== null && typed !== '' && !matches
  // The pending confirm button unmounts its focus when it is disabled; keep the keyboard inside the dialog.
  useLayoutEffect(() => { if (state?.open && !pending && error && !document.activeElement?.closest('[role="alertdialog"]')) confirmButton.current?.focus() }, [state?.open, pending, error])
  // A new request never inherits the previous typed name.
  useLayoutEffect(() => { setTyped('') }, [state?.request])
  if (!state || !request) return null
  const kind = request.kind
  const description = kind === 'deleteUser'
    ? t('confirm.deleteUser.description', { name: request.user.username })
    : kind === 'removeRole'
      ? t('confirm.removeRole.description', { role: request.roleName, user: request.username || t('confirm.fallbackUser') })
      : t('confirm.removeGroup.description', { user: request.username || t('confirm.fallbackUser'), group: request.group.name })
  const finalFocus = () => (state.successFocus ? findFocusTarget(state.successFocus) : state.opener) ?? true
  const submit = (event: FormEvent) => { event.preventDefault(); if (matches && !pending) onConfirm() }
  return <AlertDialog open={state.open} onOpenChange={(next, event) => { if (!next && pending) { event.cancel(); return } if (!next) onClose() }} onOpenChangeComplete={(next) => { if (!next) onClosed() }}>
    <AlertDialogContent size="md" aria-modal="true" container={undefined} initialFocus={() => input.current ?? confirmButton.current ?? true} finalFocus={finalFocus} className="min-w-0 max-w-full wrap-anywhere" data-testid="iam-confirm-dialog">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{t(`confirm.${kind}.title`)}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <Text as="p" variant="body" tone="destructive">{t(`confirm.${kind}.irreversible`)}</Text>
        {typedName !== null && <Field invalid={mismatch} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={`${id}-name`}>{t('confirm.typedName')}</FieldLabel>
          <Input ref={input} id={`${id}-name`} type="text" size="md" value={typed} readOnly={pending} autoComplete="off" spellCheck={false} aria-invalid={mismatch} aria-describedby={`${id}-help`} placeholder={typedName} invalid={mismatch}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} onValueChange={setTyped} />
          <FieldDescription id={`${id}-help`} aria-live="polite">{t(mismatch ? 'confirm.nameMismatch' : 'confirm.typedInstruction', { name: typedName })}</FieldDescription>
        </Field>}
        {error && <div role="alert" className="min-w-0"><Text as="p" variant="body" tone="destructive">{t(error)}</Text></div>}
        <AlertDialogFooter className="mt-5 flex-wrap gap-2">
          <AlertDialogCancel disabled={pending} className={focusRing}>{t('confirm.cancel')}</AlertDialogCancel>
          <Button ref={confirmButton} type="submit" variant="destructive" size="md" loading={pending} disabled={pending || !matches} aria-busy={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing}>{t(pending ? `confirm.${kind}.busy` : `confirm.${kind}.action`)}</Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>
}
