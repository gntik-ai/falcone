import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldLabel, Input } from '@gntik-ai/ui'
import { focusRing } from './States'

// Compose confirm-destructive with kit primitives: its built-in typed-name label
// is fixed English in 0.11.0. Keep every label local and the POST outside the dialog.
export function ConfirmRotation({ path, trigger, close, confirm }: { path: string; trigger: HTMLButtonElement | null; close: () => void; confirm: () => void }) {
  const { t } = useTranslation('pages.console-secret-rotation-page')
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const used = useRef(false)
  return <AlertDialog open={open} onOpenChange={(next) => setOpen(next)} onOpenChangeComplete={(next) => { if (!next) close() }}>
    <AlertDialogContent size="md" container={undefined} aria-modal={true} initialFocus={() => input.current} finalFocus={() => trigger} className="min-w-0 max-w-full wrap-anywhere">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('consequence', { path })}</AlertDialogDescription>
      </AlertDialogHeader>
      <form noValidate className="mt-4 space-y-4" onSubmit={(event) => {
        event.preventDefault()
        if (used.current || typed !== path) return
        used.current = true
        setOpen(false)
        confirm()
      }}>
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel htmlFor="rotation-confirm-path">{t('typedPath')}</FieldLabel>
          <Input ref={input} id="rotation-confirm-path" type="text" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} placeholder={t('typedPlaceholder')} className={focusRing} />
        </Field>
        <AlertDialogFooter className="flex-wrap gap-2">
          <AlertDialogCancel disabled={false} className={focusRing}>{t('cancel')}</AlertDialogCancel>
          <Button type="submit" variant="destructive" size="md" loading={false} disabled={typed !== path} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing}>{t('confirm')}</Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>
}
