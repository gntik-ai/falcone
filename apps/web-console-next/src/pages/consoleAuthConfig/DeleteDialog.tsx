import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Text, useAnnounce } from '@gntik-ai/ui'
import { InlineCallout } from '@gntik-ai/blocks'
import { describeFailure, failureFrom } from './model'

const NAMESPACE = 'pages.console-auth-config-page'

interface Props {
  name: string
  // Runs the DELETE. A rejection keeps the confirmation open with its error.
  onConfirm: () => Promise<void>
  returnFocus: () => HTMLElement | null
  onClose: () => void
}

// Irreversible provider removal. The kit confirm-destructive block hard-codes English type-to-confirm
// copy (gap-kit-builtin-copy-english), so the confirmation composes the kit alert dialog with
// catalog copy instead, as the legacy WARNING-level confirmation did (no typed name).
export function DeleteDialog({ name, onConfirm, returnFocus, onClose }: Props) {
  const { t } = useTranslation(NAMESPACE)
  const announce = useAnnounce()
  const [open, setOpen] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  async function confirm() {
    if (inFlight.current) return
    inFlight.current = true; setPending(true); setError(null)
    try {
      await onConfirm()
      setOpen(false)
    } catch (cause) {
      const status = failureFrom(cause).status
      const message = status === 401 ? t('deleteSessionExpired') : status === 404 ? t('deleteGone') : describeFailure(t, cause, t('deleteFailed'))
      setError(message); announce(message, 'assertive')
    } finally { inFlight.current = false; setPending(false) }
  }

  return <AlertDialog open={open} onOpenChange={(next) => { if (!next && inFlight.current) return; setOpen(next) }} onOpenChangeComplete={(next) => { if (!next) onClose() }}>
    <AlertDialogContent size="md" container={undefined} finalFocus={() => returnFocus() ?? true} className="min-w-0 max-w-full wrap-anywhere">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('deleteDescription', { name })}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="mt-4 space-y-3">
        <Text variant="body" tone="muted">{t('deleteImpact')}</Text>
        <Text variant="body" tone="destructive">{t('deleteIrreversible')}</Text>
        {error && <InlineCallout tone="destructive" title={t('deleteErrorTitle')} description={error} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
          labels={{ title: t('deleteErrorTitle'), description: error, upgrade: '', viewUsage: '' }} />}
      </div>
      <AlertDialogFooter className="mt-5">
        <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
        <Button type="button" variant="destructive" loading={pending} onClick={() => void confirm()}>{t(pending ? 'deleting' : 'deleteConfirm')}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
