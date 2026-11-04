import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldDescription, FieldLabel, Input, Text } from '@gntik-ai/ui'
import type { Failure, PlanRecord } from './api'
import { MutationFeedback } from './Feedback'
import { retryable, type Action, type DialogKind } from './model'

const NAMESPACE = 'pages.console-plan-detail-page'

// AlertDialog composition instead of the confirm-destructive block: the block hard-codes English type-to-confirm copy
// (gap-kit-builtin-copy-english). Every string, including the instruction, comes from the page catalog; only the typed
// token, the plan display name, is not translated. The typed text lives here, so it survives a retry in the open dialog
// and is cleared when the dialog is closed and opened again.
export function ConfirmDialog({ kind, open, plan, description, action, busy, failure, denied, onConfirm, onRetry, onClose, onClosed, finalFocus }: {
  kind: DialogKind
  open: boolean
  plan: PlanRecord
  description: string
  action: Action
  busy: boolean
  failure: Failure | null
  denied: boolean
  onConfirm: () => void
  onRetry: () => void
  onClose: () => void
  onClosed: () => void
  finalFocus: () => HTMLElement | null
}) {
  const { t } = useTranslation(NAMESPACE)
  const [typed, setTyped] = useState('')
  const feedback = useRef<HTMLDivElement>(null)
  const needsName = kind === 'archive' || kind === 'delete'
  const shown = failure && !(failure.status === 401 && !failure.sessionRenewed) ? failure : null
  const blocked = denied || shown?.status === 403 || shown?.status === 404
  const canRetry = Boolean(shown && retryable(shown))
  useEffect(() => { if (shown) feedback.current?.focus() }, [shown])
  const destructive = kind !== 'deprecate'
  // The typed name gates the first send and every re-send: a cleared field removes Reintentar until it matches again.
  const nameMatches = !needsName || typed === plan.displayName
  const confirmDisabled = busy || blocked || !nameMatches
  return <AlertDialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }} onOpenChangeComplete={(next) => { if (!next) onClosed() }}>
    <AlertDialogContent size="md" container={undefined} finalFocus={() => finalFocus() ?? true} className="min-w-0 max-w-full wrap-anywhere">
      <AlertDialogHeader tone={destructive ? 'destructive' : 'warning'} icon={undefined}>
        <AlertDialogTitle>{t(`dialog.${kind}Title`)}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="mt-4 min-w-0 space-y-4">
        {(kind === 'archive' || kind === 'delete') && <Text variant="body" tone="destructive">{t('dialog.irreversible')}</Text>}
        {needsName && <Field invalid={false} className="min-w-0">
          <FieldLabel htmlFor="plan-confirm-name">{t('dialog.typeLabel')}</FieldLabel>
          <Input id="plan-confirm-name" name="confirmation" value={typed} onValueChange={setTyped} readOnly={busy || blocked} invalid={false} autoComplete="off"
            aria-describedby="plan-confirm-help" />
          <FieldDescription id="plan-confirm-help">{t('dialog.typeInstruction', { name: plan.displayName })}</FieldDescription>
        </Field>}
        {shown && <MutationFeedback ref={feedback} action={action} failure={shown} busy={busy} onRetry={nameMatches ? () => { if (nameMatches) onRetry() } : undefined} titleAs="h3" />}
      </div>
      <AlertDialogFooter className="mt-5">
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{t(blocked || canRetry ? 'dialog.close' : 'dialog.cancel')}</Button>
        {!canRetry && <Button type="button" variant={destructive ? 'destructive' : 'primary'} disabled={confirmDisabled} aria-busy={busy} loading={busy} onClick={onConfirm}>
          {t(busy ? `dialog.${kind}Busy` : `dialog.${kind}Confirm`)}
        </Button>}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
