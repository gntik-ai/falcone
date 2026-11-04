import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Checkbox, Field, FieldDescription, FieldLabel, Input, Link, Text, Textarea, useAnnounce, useToast } from '@gntik-ai/ui'
import { failureOf, revokeVersion, rotationHref, type Failure, type SecretRow } from './api'
import { FailureState, focusRing } from './States'

export function RevokeDialog({ row, trigger, onClose }: { row: SecretRow; trigger: HTMLElement; onClose: () => void }) {
  const { t } = useTranslation('pages.console-secrets-page')
  const announce = useAnnounce(), toast = useToast()
  const [open, setOpen] = useState(true)
  const [typed, setTyped] = useState('')
  const [justification, setJustification] = useState('')
  const [force, setForce] = useState(row.requiresForce)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const inFlight = useRef(false)
  const id = useId()
  async function confirm() {
    if (inFlight.current || typed !== row.name) return
    inFlight.current = true; setPending(true); setFailure(null)
    try {
      await revokeVersion(row, justification, force)
      setOpen(false)
      const message = t('revoked', { name: row.name, version: row.currentVersion!.vaultVersion })
      toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' }); announce(message, 'polite')
    } catch (cause) {
      const error = failureOf(cause)
      setFailure(error)
      announce(t('revokeFailed', { name: row.name }), 'assertive')
    } finally { inFlight.current = false; setPending(false) }
  }
  const terminal = failure?.status === 403 || failure?.status === 404
  const close = <AlertDialogCancel disabled={pending} className={focusRing}>{t(failure?.status === 404 ? 'backInventory' : 'close')}</AlertDialogCancel>
  return <AlertDialog open={open} onOpenChange={(next, event) => { if (!next && inFlight.current) { event.cancel(); return } setOpen(next) }} onOpenChangeComplete={(next) => { if (!next) onClose() }}>
    <AlertDialogContent size="md" container={undefined} initialFocus={() => input.current} finalFocus={() => trigger} className="min-w-0 max-w-full wrap-anywhere">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{t('revokeTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('revokeDescription', { name: row.name, version: row.currentVersion!.vaultVersion })}</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="mt-4 space-y-4">
        {terminal ? <><FailureState failure={failure!} retry={() => void confirm()} name={row.name} version={row.currentVersion!.vaultVersion} pending={pending} /><div className="flex flex-wrap gap-3">{close}{failure?.status === 404 && <Link href={rotationHref(row)} tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('viewHistory')}</Link>}</div></> : <>
          {row.requiresForce && <Alert tone="warning" role="alert" title={t('lastVersionTitle')} description={t('lastVersionWarning')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('close')} />}
          <Field invalid={Boolean(typed && typed !== row.name)} disabled={pending} className="min-w-0">
            <FieldLabel htmlFor={`${id}-name`}>{t('typedName')}</FieldLabel>
            <Input ref={input} id={`${id}-name`} type="text" value={typed} disabled={pending} autoComplete="off" placeholder={t('typedPlaceholder')} aria-describedby={`${id}-help`} aria-invalid={Boolean(typed && typed !== row.name)} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => setTyped(event.target.value)} />
            <FieldDescription id={`${id}-help`} aria-live="polite">{t(typed && typed !== row.name ? 'nameMismatch' : 'typedInstruction', { name: row.name })}</FieldDescription>
          </Field>
          <Field invalid={false} disabled={pending} className="min-w-0"><FieldLabel htmlFor={`${id}-reason`}>{t('justification')}</FieldLabel>
            <Textarea id={`${id}-reason`} value={justification} placeholder={t('justificationPlaceholder')} disabled={pending} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => setJustification(event.target.value)} />
          </Field>
          <Checkbox checked={force} defaultChecked={row.requiresForce} disabled={pending} onCheckedChange={(checked) => setForce(checked)} label={t('force')} className={focusRing} />
          {failure && <FailureState failure={failure} retry={() => void confirm()} name={row.name} version={row.currentVersion!.vaultVersion} pending={pending} />}
          <Text variant="body" tone="muted">{t('irreversible')}</Text>
        </>}
      </div>
      {!terminal && <AlertDialogFooter className="mt-5 flex-wrap gap-2">
        <AlertDialogCancel disabled={pending} className={focusRing}>{t('cancel')}</AlertDialogCancel>
        <Button type="button" variant="destructive" size="md" loading={pending} disabled={pending || typed !== row.name} aria-busy={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => void confirm()}>{t('confirm')}</Button>
      </AlertDialogFooter>}
    </AlertDialogContent>
  </AlertDialog>
}
