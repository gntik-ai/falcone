import { useRef, useState } from 'react'
import { useCopy, focusRing } from './copy'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Field, FieldLabel, Input } from '@gntik-ai/ui'

// Compose confirm-destructive with kit primitives: its built-in typed-name label
// is fixed English in 0.12.0. Keep every label local and the POST outside the dialog.
export function ConfirmRotation({ name, trigger, close, confirm }: { name: string; trigger: HTMLButtonElement | null; close: () => void; confirm: () => Promise<void> }) {
  const { t } = useCopy()
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const used = useRef(false)
  return <AlertDialog open={open} onOpenChange={(next) => { if (!used.current) setOpen(next) }} onOpenChangeComplete={(next) => { if (!next) close() }}>
    {/* After confirmation the page owns focus once both the dialog and request settle. */}
    <AlertDialogContent size="md" container={undefined} aria-modal={true} initialFocus={() => input.current} finalFocus={() => used.current ? false : trigger} className="min-w-0 max-w-full wrap-anywhere">
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('consequence', { name })}</AlertDialogDescription>
      </AlertDialogHeader>
      <form noValidate className="mt-4 space-y-4" onSubmit={async (event) => {
        event.preventDefault()
        if (used.current || typed !== name) return
        used.current = true
        setPending(true)
        await confirm()
        setOpen(false)
      }}>
        <Field invalid={false} disabled={pending} className="min-w-0">
          <FieldLabel htmlFor="database-confirm-name">{t('typedName')}</FieldLabel>
          <Input ref={input} id="database-confirm-name" type="text" value={typed} onChange={(event) => setTyped(event.target.value)} disabled={pending} autoComplete="off" spellCheck={false} placeholder={t('typedPlaceholder')} className={focusRing} />
        </Field>
        <AlertDialogFooter className="flex-wrap gap-2">
          <AlertDialogCancel disabled={pending} className={focusRing}>{t('cancel')}</AlertDialogCancel>
          <Button type="submit" variant="destructive" size="md" loading={pending} disabled={pending || typed !== name} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing}>{t('confirm')}</Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>
}
