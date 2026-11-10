import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Alert, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Text } from '@gntik-ai/ui'
import { VALUE_MAX, type Failure } from './api'
import { classify, describeWrite, focusRing, useCopy, type WriteKind } from './copy'
import { WriteFailure } from './States'
import type { DeleteState, ReplaceState } from './useWorkspaceSecrets'

// A dialog keeps its last content while it fades out, with any secret value already blanked.
function useRetained<T extends object>(state: T | null): T | null {
  const last = useRef<T | null>(null)
  if (state) last.current = state
  else if (last.current && 'value' in last.current) last.current = { ...last.current, value: '' }
  return state ?? last.current
}

interface ConfirmProps {
  open: boolean
  kind: WriteKind
  name: string
  title: string
  description: string
  pending: boolean
  failure: Failure | null
  body: JSX.Element
  actionLabel: string
  busyLabel: string
  finalFocus: () => HTMLElement | boolean
  onConfirm: () => void
  onCancel: () => void
}

// Typed confirmation for the irreversible replace and delete. It is composed from alert-dialog because the
// kit confirm-destructive block hard-codes an English typed-name prompt. The typed name survives a failed
// write, Cancel and Escape send nothing, and a failure renders its panel once.
function TypedConfirm({ open, kind, name, title, description, pending, failure, body, actionLabel, busyLabel, finalFocus, onConfirm, onCancel }: ConfirmProps) {
  const { t } = useCopy()
  const id = useId()
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const wasPending = useRef(false)
  const matches = typed === name
  const failureClass = failure ? classify(failure) : null
  // A new confirmation never inherits the previous typed name.
  useLayoutEffect(() => { if (!open) setTyped('') }, [open, name])
  // Non-retryable failures keep focus in the dialog: the input first, then Cancel.
  useEffect(() => {
    if (wasPending.current && !pending && failureClass === 'inline' && !document.activeElement?.closest('[role="alertdialog"]')) (input.current ?? cancel.current)?.focus()
    wasPending.current = pending
  }, [pending, failureClass])
  // Confirm and Reintentar share one guard: a failed write is never re-sent unless the typed name still matches.
  const send = () => { if (matches && !pending) onConfirm() }
  const submit = (event: FormEvent) => { event.preventDefault(); send() }
  return <AlertDialog open={open} onOpenChange={(next, event) => { if (next) return; if (pending) { event.cancel(); return } onCancel() }}>
    <AlertDialogContent size="md" aria-modal="true" container={undefined} initialFocus={() => input.current ?? true} finalFocus={finalFocus} className="min-w-0" data-testid={`workspace-secrets-confirm-${kind}`}>
      <AlertDialogHeader tone="destructive" icon={undefined}>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <form onSubmit={submit} noValidate className="mt-4 min-w-0 space-y-4">
        {body}
        <Field invalid={false} disabled={false} className="min-w-0">
          <FieldLabel htmlFor={`${id}-typed`}>{t('confirm.typedLabel')}</FieldLabel>
          <Input ref={input} id={`${id}-typed`} data-secret-field="typed-name" type="text" size="md" value={typed} readOnly={pending} autoComplete="off" spellCheck={false} placeholder={name}
            leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => setTyped(event.target.value)} />
        </Field>
        {failure && (failureClass === 'retry'
          ? <WriteFailure kind={kind} failure={failure} retry={send} retrying={pending} target="confirm" />
          : <div data-testid="workspace-secrets-confirm-error"><Alert tone="destructive" role={undefined} title={undefined} description={describeWrite(t, kind, failure)} actions={undefined} icon={undefined} onDismiss={undefined} dismissLabel="" /></div>)}
        <AlertDialogFooter className="mt-5 flex-wrap gap-2">
          <AlertDialogCancel ref={cancel} disabled={pending} className={focusRing}>{t('confirm.cancel')}</AlertDialogCancel>
          <Button type="submit" variant="destructive" size="md" loading={pending} disabled={pending || !matches} aria-busy={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing}>{pending ? busyLabel : actionLabel}</Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>
}

interface DeleteProps {
  state: DeleteState | null
  production: boolean
  finalFocus: () => HTMLElement | boolean
  onConfirm: () => void
  onCancel: () => void
}

// Every Eliminar is typed-name confirmed: referenced, production and unreferenced secrets alike.
export function DeleteConfirm({ state, production, finalFocus, onConfirm, onCancel }: DeleteProps) {
  const { t } = useCopy()
  const shown = useRetained(state)
  if (!shown) return null
  const impact = [shown.refCount > 0 ? t('delete.referenced', { count: shown.refCount }) : t('delete.unreferenced'), production ? t('delete.production') : null].filter(Boolean).join(' ')
  const body = <>
    <div className="min-w-0 space-y-2">
      <Text as="p" variant="body" tone="default" className="break-words">{t('delete.line', { name: shown.name })}</Text>
      <Text as="p" variant="body" tone="muted" className="break-words">{impact}</Text>
    </div>
    <section className="min-w-0 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">{t('delete.cascade')}</h3>
      {shown.refCount > 0
        ? <ul className="space-y-1 text-sm text-foreground"><li>{t('delete.cascadeItem', { count: shown.refCount })}</li></ul>
        : <Text as="p" variant="body" tone="muted">{t('delete.cascadeNone')}</Text>}
    </section>
    <Text as="p" variant="body" tone="destructive">{t('delete.irreversible')}</Text>
  </>
  return <TypedConfirm open={state !== null} kind="delete" name={shown.name} title={t('delete.title')} description={t('delete.description')} pending={shown.pending} failure={shown.failure} body={body}
    actionLabel={t('delete.action')} busyLabel={t('delete.busy')} finalFocus={finalFocus} onConfirm={onConfirm} onCancel={onCancel} />
}

interface ReplaceProps {
  state: ReplaceState | null
  finalFocus: () => HTMLElement | boolean
  onField: (field: 'value' | 'description', value: string) => void
  onSubmit: () => void
  onClose: () => void
  onConfirm: () => void
  onCancelConfirm: () => void
}

// Two steps: the dialog collects the new value, then the typed confirmation sends the one PUT. The value is
// never prefilled and stays in memory only while either step is open.
export function ReplaceFlow({ state, finalFocus, onField, onSubmit, onClose, onConfirm, onCancelConfirm }: ReplaceProps) {
  const { t } = useCopy()
  const id = useId()
  const shown = useRetained(state)
  const valueInput = useRef<HTMLInputElement>(null)
  const submit = useRef<HTMLButtonElement>(null)
  const stage = useRef<ReplaceState['stage']>('edit')
  stage.current = shown?.stage ?? 'edit'
  if (!shown) return null
  const open = state !== null && state.stage === 'edit'
  const error = shown.validation ? t(shown.validation === 'required' ? 'validation.valueRequired' : 'validation.valueMax', { max: VALUE_MAX }) : null
  const body = <>
    <Text as="p" variant="body" tone="default" className="break-words">{t('replace.confirmLine', { name: shown.name })}</Text>
    <Text as="p" variant="body" tone="destructive">{t('replace.confirmImpact')}</Text>
    <Text as="p" variant="body" tone="destructive">{t('confirm.irreversible')}</Text>
  </>
  return <>
    <Dialog open={open} onOpenChange={(next, event) => { if (next) return; if (shown.pending) { event.cancel(); return } onClose() }}>
      <DialogContent size="md" showClose={true} closeLabel={t('close')} container={undefined} initialFocus={() => (shown.returned ? submit.current : valueInput.current) ?? true}
        finalFocus={() => stage.current === 'confirm' ? false : finalFocus()} className="min-w-0" data-testid="workspace-secrets-replace-dialog">
        <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} noValidate className="min-w-0">
          <DialogHeader>
            <DialogTitle>{t('replace.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('replace.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="min-w-0 space-y-4">
            <Text as="p" variant="body" tone="muted" className="break-words">{t('replace.secretLine', { name: shown.name })}</Text>
            <Field invalid={Boolean(error)} disabled={false} className="min-w-0">
              <FieldLabel htmlFor={`${id}-value`}>{t('replace.valueLabel')}</FieldLabel>
              <Input ref={valueInput} id={`${id}-value`} data-secret-field="replace-value" type="password" size="md" value={shown.value} invalid={Boolean(error)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
                placeholder={t('create.valuePlaceholder')} autoComplete="new-password" leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`}
                onChange={(event) => onField('value', event.target.value)} />
              {error && <Text as="p" variant="body" tone="destructive" id={`${id}-error`} role="alert" data-secret-error="replace-value">{error}</Text>}
            </Field>
            <Field invalid={false} disabled={false} className="min-w-0">
              <FieldLabel htmlFor={`${id}-description`}>{t('replace.descriptionLabel')}</FieldLabel>
              <Input id={`${id}-description`} data-secret-field="replace-description" type="text" size="md" value={shown.description} autoComplete="off" leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined}
                className={`w-full min-w-0 ${focusRing}`} onChange={(event) => onField('description', event.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={`w-full sm:w-auto ${focusRing}`} onClick={onClose}>{t('replace.cancel')}</Button>
            <Button ref={submit} type="submit" variant="primary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} data-secret-field="replace-submit" className={`w-full sm:w-auto ${focusRing}`}>{t('replace.submit')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <TypedConfirm open={state !== null && state.stage === 'confirm'} kind="replace" name={shown.name} title={t('replace.confirmTitle')} description={t('replace.confirmDescription')} pending={shown.pending} failure={shown.failure} body={body}
      actionLabel={t('replace.confirmAction')} busyLabel={t('replace.confirmBusy')} finalFocus={() => stage.current === 'edit' && state !== null ? false : finalFocus()} onConfirm={onConfirm} onCancel={onCancelConfirm} />
  </>
}
