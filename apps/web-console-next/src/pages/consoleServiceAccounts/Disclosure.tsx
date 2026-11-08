import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, CodeBlock, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, SecretField, Text, useAnnounce } from '@gntik-ai/ui'
import type { IssuedCredential } from './api'
import { focusRing } from './Failure'

export type DisclosureMode = 'reveal' | 'rotate'
interface Props {
  mode: DisclosureMode
  credential: IssuedCredential
  open: boolean
  onClose: () => void
  onClosed: () => void
  finalFocus: () => HTMLElement | boolean
}

// One-time credential disclosure (gap-b005-credential-disclosure-dialog). It opens only after a
// successful response. The secret is never written to a title, tooltip, log or live region.
export function Disclosure({ mode, credential, open, onClose, onClosed, finalFocus }: Props) {
  const { t, i18n } = useTranslation('pages.console-service-accounts-page')
  const announce = useAnnounce()
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const [feedback, setFeedback] = useState('')
  const expiry = credential.expiresAt
  const parsed = expiry ? Date.parse(expiry) : NaN
  async function copy() {
    let message = t('disclosure.copied')
    if (!navigator.clipboard?.writeText) message = t('disclosure.copyFallback')
    else {
      try { await navigator.clipboard.writeText(credential.secret) } catch { message = t('disclosure.copyFallback') }
    }
    setFeedback(message); announce(message, 'polite')
  }
  return <Dialog open={open} modal={true} onOpenChange={(next) => { if (!next) onClose() }} onOpenChangeComplete={(next) => { if (!next) onClosed() }}>
    <DialogContent ref={panel} aria-modal="true" size="md" presentation="responsive" showClose={false} closeLabel={t('disclosure.close')} container={undefined}
      initialFocus={() => panel.current} finalFocus={finalFocus} className="min-w-0 max-w-full wrap-anywhere">
      <DialogHeader>
        <DialogTitle>{t(`disclosure.${mode}Title`)}</DialogTitle>
        <DialogDescription>{t(`disclosure.${mode}Description`)}</DialogDescription>
      </DialogHeader>
      <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt><Text as="span" variant="supporting" tone="muted">{t('disclosure.credentialId')}</Text></dt><dd className="mt-1 break-all font-mono text-xs">{credential.credentialId}</dd></div>
          <div><dt><Text as="span" variant="supporting" tone="muted">{t('disclosure.expires')}</Text></dt>
            <dd className="mt-1 text-sm">{!expiry ? t('table.noExpiry') : Number.isNaN(parsed) ? expiry : new Date(parsed).toLocaleString(i18n.language)}</dd></div>
        </dl>
        {mode === 'rotate' && <Alert tone="warning" role="status" title={t('disclosure.rotateWarningTitle')} description={t('disclosure.rotateWarning')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('disclosure.close')} />}
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={`${id}-secret`}>{t('disclosure.secretLabel')}</FieldLabel>
          {mode === 'reveal'
            ? <SecretField id={`${id}-secret`} value={credential.secret} editable={false} defaultRevealed={false} copyable={false} showLabel={t('disclosure.show')} hideLabel={t('disclosure.hide')} aria-label={t('disclosure.secretValue')} className={focusRing} />
            : <CodeBlock code={credential.secret} language={undefined} filename={undefined} showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={160} highlight={undefined} label={t('disclosure.secretValue')} />}
        </Field>
      </DialogBody>
      <DialogFooter className="flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" className="min-h-5 min-w-0 flex-1 text-sm text-muted-foreground">{feedback}</p>
        <div className="flex flex-wrap gap-2.5">
          <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} aria-label={t('disclosure.copyAria')} className={focusRing} onClick={() => void copy()}>{t('disclosure.copy')}</Button>
          <Button type="button" variant="primary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={onClose}>{t('disclosure.close')}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
