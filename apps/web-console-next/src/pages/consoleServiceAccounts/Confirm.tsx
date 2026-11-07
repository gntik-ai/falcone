import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldDescription, FieldLabel, Input, Text } from '@gntik-ai/ui'
import { accountName, type Failure, type ServiceAccount } from './api'
import { FailureView, focusRing, presentationOf } from './Failure'

export type ConfirmAction = 'rotate' | 'revoke' | 'delete'
interface Props {
  action: ConfirmAction
  account: ServiceAccount
  open: boolean
  pending: boolean
  failure: Failure | null
  onConfirm: () => void
  onRetry: () => void
  onClose: () => void
  onBack: () => void
  onClosed: () => void
  finalFocus: () => HTMLElement | boolean
}

// Typed confirmation composed from alert-dialog (gap-b005-confirm-destructive-extra-fields): the
// kit block hard-codes its typed-name prompt in English, and the failure surfaces need to replace the
// body. The typed name is local state, so it survives a failed attempt.
export function ConfirmDialog({ action, account, open, pending, failure, onConfirm, onRetry, onClose, onBack, onClosed, finalFocus }: Props) {
  const { t } = useTranslation('pages.console-service-accounts-page')
  const name = accountName(account)
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const id = useId()
  const matches = typed === name
  const mismatch = typed !== '' && !matches
  const terminal = failure !== null && ['no-access', 'not-found'].includes(presentationOf(action, failure))
  // Keep the keyboard on a live control once the pending confirm button unmounts its focus.
  useLayoutEffect(() => { if (!pending && failure && !terminal && document.activeElement === document.body) confirmButton.current?.focus() }, [pending, failure, terminal])
  function submit(event: FormEvent) { event.preventDefault(); if (matches && !pending) onConfirm() }
  return <AlertDialog open={open} onOpenChange={(next, event) => { if (!next && pending) { event.cancel(); return } if (!next) onClose() }} onOpenChangeComplete={(next) => { if (!next) onClosed() }}>
    <AlertDialogContent size="md" aria-modal="true" container={undefined} initialFocus={() => input.current} finalFocus={finalFocus} className="min-w-0 max-w-full wrap-anywhere">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{t(`confirm.${action}.title`, { name })}</AlertDialogTitle>
        <AlertDialogDescription>{t(`confirm.${action}.description`)}</AlertDialogDescription>
      </AlertDialogHeader>
      {terminal
        ? <div className="mt-4"><FailureView scope={action} failure={failure!} name={name} pending={pending} onRetry={onRetry} onClose={onClose} onBack={onBack} /></div>
        : <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          {action !== 'rotate' && <Text as="p" variant="body" tone="destructive">{t(`confirm.${action}.irreversible`)}</Text>}
          <Field invalid={mismatch} disabled={false} className="min-w-0">
            <FieldLabel htmlFor={`${id}-name`}>{t('confirm.typedName')}</FieldLabel>
            <Input ref={input} id={`${id}-name`} type="text" value={typed} readOnly={pending} autoComplete="off" spellCheck={false} aria-invalid={mismatch} aria-describedby={`${id}-help`}
              placeholder={name} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => setTyped(event.target.value)} />
            <FieldDescription id={`${id}-help`} aria-live="polite">{t(mismatch ? 'confirm.nameMismatch' : 'confirm.typedInstruction', { name })}</FieldDescription>
          </Field>
          {failure && <FailureView scope={action} failure={failure} name={name} pending={pending} onRetry={onRetry} onClose={onClose} onBack={onBack} onAlertShown={() => confirmButton.current?.focus()} />}
          <AlertDialogFooter className="mt-5 flex-wrap gap-2">
            <AlertDialogCancel disabled={pending} className={focusRing}>{t('confirm.cancel')}</AlertDialogCancel>
            <Button ref={confirmButton} type="submit" variant="destructive" size="md" loading={pending} disabled={pending || !matches} aria-busy={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing}>{t(`confirm.${action}.action`)}</Button>
          </AlertDialogFooter>
        </form>}
    </AlertDialogContent>
  </AlertDialog>
}
