import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Field, FieldLabel, I18nProvider, Input, LiveAnnouncer, Page, PasswordInput, Slider, Textarea, ToastProvider, Toaster, useAnnounce, useToast } from '@gntik-ai/ui'
import { FormSection, NotFoundEmpty, PageHeader, StickyActionBar, ValidationSummary } from '@gntik-ai/blocks'
import { initiateSecretRotation, parseRotationSecretPath } from './consoleSecretRotation/api'
import i18n from '../i18n'
import es from '../locales/es/pages.console-secret-rotation-page.json'
import en from '../locales/en/pages.console-secret-rotation-page.json'
import { BackLink, focusRing } from './consoleSecretRotation/States'
import { ConfirmRotation } from './consoleSecretRotation/ConfirmRotation'
import { RotationLists } from './consoleSecretRotation/Tables'
import { failureOf, type Failure } from './consoleSecretRotation/state'
import './consoleSecretRotation/page.css'

i18n.addResourceBundle('es', 'pages.console-secret-rotation-page', es)
i18n.addResourceBundle('en', 'pages.console-secret-rotation-page', en)

function RotationContent({ path }: { path: string }) {
  const { t } = useTranslation('pages.console-secret-rotation-page')
  const announce = useAnnounce(), toast = useToast()
  const [grace, setGrace] = useState(1800)
  const [justification, setJustification] = useState('')
  const [newValue, setNewValue] = useState('')
  const [dialog, setDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [submitCount, setSubmitCount] = useState(0)
  const bar = useRef<HTMLFieldSetElement>(null)
  const summary = useRef<HTMLDivElement>(null)
  const flight = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (failure && !dialog) summary.current?.querySelector<HTMLElement>('[role="region"]')?.focus()
  }, [failure, dialog])
  const dirty = grace !== 1800 || justification !== '' || newValue !== ''
  const trigger = () => bar.current?.querySelectorAll<HTMLButtonElement>('button').item(1) ?? null
  const open = () => { if (!flight.current) setDialog(true) }
  async function send() {
    if (flight.current) return
    flight.current = true
    setSaving(true); setFailure(null)
    try {
      const result = await initiateSecretRotation(path, { gracePeriodSeconds: grace, justification, newValue })
      if (!mounted.current) return
      const message = t('success', { version: result.vaultVersionNew, expiry: result.graceExpiresAt ?? t('missing') })
      toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' }); announce(message, 'polite')
    } catch (cause) {
      if (!mounted.current) return
      const error = failureOf(cause, newValue)
      setFailure(error); setSubmitCount((value) => value + 1)
      const message = t('submitFailure', { message: error.message || t('networkError') })
      toast.add({ title: message, description: undefined, tone: 'destructive', priority: 'high' }); announce(message, 'assertive')
    } finally {
      flight.current = false
      if (mounted.current) setSaving(false)
    }
  }
  return <>
    <form id="secret-rotation-form" noValidate onSubmit={(event) => { event.preventDefault(); open() }} className="min-w-0 space-y-6">
      <div ref={summary} data-testid="validation-summary"><ValidationSummary errors={failure ? [{ fieldId: 'rotation-justification', label: t('justification'), message: t('submitFailure', { message: failure.message || t('networkError') }) }] : []} submitCount={submitCount} title={t('validationTitle')} labels={{ title: () => t('validationTitle') }} className="min-w-0" /></div>
      <FormSection title={t('formTitle')} description={null} labels={{ title: t('formTitle'), description: '' }} actions={null} headingLevel="h2" divided={false} className="min-w-0">
        <div className="min-w-0 space-y-4">
        <Field invalid={false} disabled={saving} className="min-w-0 space-y-2">
          <FieldLabel htmlFor="rotation-grace-slider">{t('grace')}</FieldLabel>
          <Slider id="rotation-grace-slider" min={300} max={86400} step={1} value={Math.max(300, Math.min(86400, grace))} defaultValue={1800} onValueChange={(value) => setGrace(Number(value))} disabled={saving} label={null} aria-label={t('sliderName')} thumbLabels={[t('sliderName')]} showValue={false} formatValue={undefined} size="md" className={focusRing} />
        </Field>
        <Field invalid={false} disabled={saving} className="min-w-0">
          <FieldLabel htmlFor="rotation-grace" className="sr-only">{t('inputName')}</FieldLabel>
          <Input id="rotation-grace" type="number" min={300} max={86400} value={grace} onChange={(event) => setGrace(Number(event.target.value))} disabled={saving} aria-label={t('inputName')} className={focusRing} />
        </Field>
        <Field invalid={false} disabled={saving} className="min-w-0">
          <FieldLabel htmlFor="rotation-justification">{t('justification')}</FieldLabel>
          <Textarea id="rotation-justification" required value={justification} onChange={(event) => setJustification(event.target.value)} disabled={saving} aria-label={t('justification')} className={focusRing} />
        </Field>
        <Field invalid={false} disabled={saving} className="min-w-0">
          <FieldLabel htmlFor="rotation-new-value">{t('newValue')}</FieldLabel>
          <PasswordInput id="rotation-new-value" value={newValue} defaultValue="" onValueChange={setNewValue} defaultVisible={false} showStrength={false} strength={undefined} strengthLabels={[t('strength'), t('strength'), t('strength'), t('strength'), t('strength')]} strengthPrefix={t('strength')} showLabel={t('showValue')} hideLabel={t('hideValue')} disabled={saving} autoComplete="new-password" aria-label={t('newValue')} className={focusRing} wrapperClassName="min-w-0" />
        </Field>
        </div>
      </FormSection>
    </form>
    <fieldset ref={bar} disabled={saving} aria-busy={saving} aria-label={t('actions')} className="sticky bottom-0 z-20 order-last m-0 min-w-0 border-0 p-0">
      {/* Rotation may submit unchanged defaults; dirty controls the status copy, not authorization. */}
      <StickyActionBar dirty={!saving} saving={saving} onSave={open} onCancel={() => { if (!flight.current) { setGrace(1800); setJustification(''); setNewValue(''); setFailure(null) } }} dirtyMessage={t(dirty ? 'dirty' : 'clean')} cleanMessage={t('clean')} saveLabel={t('submit')} cancelLabel={t('discard')} hideWhenClean={false} aria-label={t('actions')} className="min-w-0" />
    </fieldset>
    <RotationLists path={path} />
    {dialog && <ConfirmRotation path={path} trigger={trigger()} close={() => setDialog(false)} confirm={() => void send()} />}
  </>
}
function LocalizedToaster() {
  const { t } = useTranslation('pages.console-secret-rotation-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    const translate = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('notifications')) viewport.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}
export default function ConsoleSecretRotationPage() {
  const { t, i18n: language } = useTranslation('pages.console-secret-rotation-page')
  const { encodedSecretPath = '' } = useParams()
  let path = '', valid = false
  try { path = decodeURIComponent(encodedSecretPath); parseRotationSecretPath(path); valid = true } catch { /* Invalid routes never mount the readers or form. */ }
  // resource-form composition avoids the template's fixed project/billing fields and sample data.
  return <I18nProvider locale={language.language} messages={{ 'actionBar.saving': t('saving'), 'common.cancel': t('cancel'), 'common.close': t('closeToast') }}><LiveAnnouncer><ToastProvider timeout={5000} limit={1} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="console-secret-rotation-page"
      header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={path} breadcrumbs={[]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description: path, moreActions: t('actions'), sections: t('actions') }} />}>
      {valid ? <RotationContent key={path} path={path} /> : <NotFoundEmpty title={t('notFound')} description={t('invalidPath')} icon={undefined} action={<BackLink />} titleAs="h2" bordered={false} className="min-w-0" />}
    </Page><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
