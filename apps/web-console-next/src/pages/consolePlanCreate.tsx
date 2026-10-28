import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, Field, FieldDescription, FieldError, FieldLabel, Input, Link, Page, Textarea, useAnnounce } from '@gntik-ai/ui'
import { ErrorPanel, FirstRunEmpty, FormSection, NoAccessEmpty, NotFoundEmpty, PageHeader, TableSkeleton, ValidationSummary } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { Guard } from '../shell/guards'
import { useConsoleContext } from '../shell/context'
import i18n from '../i18n'
import es from '../locales/es/pages.console-plan-create-page.json'
import en from '../locales/en/pages.console-plan-create-page.json'
import { createPlan, type PlanCreateBody } from './consolePlanCreate/api'

i18n.addResourceBundle('es', 'pages.console-plan-create-page', es)
i18n.addResourceBundle('en', 'pages.console-plan-create-page', en)
const validSlug = (value: string) => /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(value)
type Failure = Pick<Partial<ApiError>, 'status' | 'code' | 'requestId'>

// Keep transport messages and details out of page state as well as the DOM.
function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    code: typeof error.code === 'string' ? error.code : '',
    requestId: typeof error.requestId === 'string' && error.requestId ? error.requestId : typeof error.correlationId === 'string' ? error.correlationId : '',
  }
}

function PlanForm() {
  const { t } = useTranslation('pages.console-plan-create-page')
  const navigate = useNavigate()
  const announce = useAnnounce()
  const { loading } = useConsoleContext()
  const [values, setValues] = useState({ slug: '', displayName: '', description: '' })
  const [pristine, setPristine] = useState(true)
  const [invalid, setInvalid] = useState({ slug: false, displayName: false })
  const [validationAttempt, setValidationAttempt] = useState(0)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const retained = useRef<PlanCreateBody | null>(null)
  const mounted = useRef(false)
  const retryFocus = useRef(false)
  const slugInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const summary = useRef<HTMLDivElement>(null)
  const errorPanel = useRef<HTMLDivElement>(null)
  const readOnly = failure?.status === 403

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!validationAttempt) return
    if (invalid.displayName && !invalid.slug) nameInput.current?.focus()
    else summary.current?.querySelector<HTMLElement>('[role="region"]')?.focus()
  }, [validationAttempt])
  useEffect(() => {
    if (!failure || saving || failure.status === 401) return
    if (retryFocus.current) errorPanel.current?.querySelector<HTMLButtonElement>('button[data-plan-retry]')?.focus()
    else errorPanel.current?.focus()
  }, [failure, saving])

  function change(field: keyof typeof values, value: string) {
    if (inFlight.current || readOnly) return
    setValues((previous) => ({ ...previous, [field]: value }))
    setPristine(false)
    setFailed(false)
    setFailure(null)
    retained.current = null
    setInvalid((previous) => ({ ...previous,
      ...(field === 'slug' && validSlug(value) ? { slug: false } : {}),
      ...(field === 'displayName' && value.trim() ? { displayName: false } : {}),
    }))
  }

  async function send(body: PlanCreateBody, retry: boolean) {
    if (inFlight.current || readOnly) return
    inFlight.current = true
    retryFocus.current = retry
    retained.current = body
    setSaving(true)
    try {
      const created = await createPlan(body)
      if (!mounted.current) return
      announce(t('success'), 'assertive')
      navigate(`/console/plans/${created.id}`)
    } catch (cause) {
      if (!mounted.current) return
      inFlight.current = false
      setFailure(failureOf(cause))
      setFailed(true)
      setSaving(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || failed || readOnly) return
    const errors = { slug: !validSlug(values.slug), displayName: !values.displayName.trim() }
    setInvalid(errors)
    if (errors.slug || errors.displayName) { setValidationAttempt((count) => count + 1); return }
    void send({ ...values, displayName: values.displayName.trim(), capabilities: {}, quotaDimensions: {} }, false)
  }
  const issues = [
    ...(invalid.slug ? [{ fieldId: 'plan-slug', label: t('slug'), message: t('invalidSlug') }] : []),
    ...(invalid.displayName ? [{ fieldId: 'plan-display-name', label: t('displayName'), message: t('requiredName') }] : []),
  ]
  const message = failure?.status === 409 ? t('conflict') : failure?.status === 400 ? t('badRequest') : !failure?.status ? t('outcomeUnknown') : t('errorMessage')
  const back = <Link href="/console/plans" underline="always">{t('back')}</Link>
  const header = <PageHeader as="div" wrapTitle={true} title={t('title')} description={null}
    breadcrumbs={[{ label: t('catalog'), href: '/console/plans' }, { label: t('title') }]}
    status="" statuses={{}} meta={[]} actions={[]} tabs={null}
    labels={{ title: t('title'), description: '', moreActions: t('actions'), sections: t('sectionTitle') }} />

  const feedback = failure && failure.status !== 401 && <div ref={errorPanel} tabIndex={-1} data-testid="error-panel"
          className="min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
          {failure.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" onRequestAccess={undefined} showRequestAccess={false}
            action={{ label: t('back'), href: '/console/plans' }} defaultRequested={false} titleAs="h2" bordered={false}
            labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
            : failure.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={back} titleAs="h2" bordered={false} />
              : <ErrorPanel title={t('errorTitle')} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''}
                details={failure.code ?? ''} onRetry={undefined} retrying={saving} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true}
                labels={{ title: t('errorTitle'), message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'),
                  requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
          {![401, 403, 404].includes(failure.status ?? 0) && <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button type="button" data-plan-retry loading={saving} aria-busy={saving} variant="secondary"
              onClick={() => { if (retained.current) void send(retained.current, true) }}>{t(saving ? 'retrying' : 'retry')}</Button>
            {!failure.status && back}
          </div>}
        </div>

  // Compose resource-form from kit slots: the template has fixed billing fields;
  // StickyActionBar cannot supply the legacy catalog href or independent submit gating.
  return <Page width="default" header={header} title={null} description={null} actions={null}
    className="console-plan-create min-w-0 wrap-anywhere" actionBarLabel={t('actions')}
    actionBar={loading ? null : <div className="flex flex-wrap items-center justify-end gap-4">
      <Link href="/console/plans" underline="always">{t('discard')}</Link>
      <Button type="submit" form="plan-create-form" loading={saving} disabled={saving || failed || readOnly}
        aria-busy={saving} variant="primary">{t(saving ? 'saving' : 'create')}</Button>
    </div>}>
    {loading ? <div role="status" aria-label={t('loading')} aria-busy={true}>
      <div aria-hidden={true}><TableSkeleton rows={3} columns={1} label={t('loading')} className="min-w-0" /></div>
    </div> : <>
      {pristine && <FirstRunEmpty title={t('firstTitle')} description={t('firstDescription')}
        steps={[t('stepSlug'), t('stepName'), t('stepDescription'), t('stepLimits')]}
        actionLabel={t('start')} onAction={() => slugInput.current?.focus()} secondary={null} titleAs="h2" bordered={false}
        labels={{ title: t('firstTitle'), description: t('firstDescription'), action: t('start'), guide: '' }} className="min-w-0" />}
      {(failure?.status === 403 || failure?.status === 404) && feedback}
      <form id="plan-create-form" onSubmit={submit} noValidate className="min-w-0 space-y-6 pb-6">
        <div ref={summary} data-testid="validation-summary"><ValidationSummary errors={issues} submitCount={0}
          title={t('validationTitle')} labels={{ title: () => t('validationTitle') }} className="min-w-0" /></div>
        <FormSection title={t('sectionTitle')} description={t('sectionHelp')} labels={{ title: t('sectionTitle'), description: t('sectionHelp') }}
          actions={null} headingLevel="h2" divided={false} className="min-w-0">
          <Field invalid={invalid.slug} className="min-w-0">
            <FieldLabel htmlFor="plan-slug">{t('slug')}</FieldLabel>
            <Input ref={slugInput} id="plan-slug" name="slug" value={values.slug} onValueChange={(value) => change('slug', value)}
              readOnly={saving || readOnly} invalid={invalid.slug} aria-invalid={invalid.slug || undefined}
              aria-describedby={invalid.slug ? 'plan-slug-help plan-slug-error' : 'plan-slug-help'} />
            <FieldDescription id="plan-slug-help">{t('slugHelp')}</FieldDescription>
            {invalid.slug && <FieldError id="plan-slug-error" match={true}>{t('invalidSlug')}</FieldError>}
          </Field>
          <Field invalid={invalid.displayName} className="min-w-0">
            <FieldLabel htmlFor="plan-display-name">{t('displayName')}</FieldLabel>
            <Input ref={nameInput} id="plan-display-name" name="displayName" value={values.displayName} onValueChange={(value) => change('displayName', value)}
              readOnly={saving || readOnly} invalid={invalid.displayName} aria-invalid={invalid.displayName || undefined}
              aria-describedby={invalid.displayName ? 'plan-name-help plan-name-error' : 'plan-name-help'} />
            <FieldDescription id="plan-name-help">{t('nameHelp')}</FieldDescription>
            {invalid.displayName && <FieldError id="plan-name-error" match={true}>{t('requiredName')}</FieldError>}
          </Field>
          <Field invalid={false} className="min-w-0">
            <FieldLabel htmlFor="plan-description">{t('description')}</FieldLabel>
            <Textarea id="plan-description" name="description" value={values.description} onValueChange={(value) => change('description', value)}
              readOnly={saving || readOnly} invalid={false} rows={4} aria-describedby="plan-description-help" />
            <FieldDescription id="plan-description-help">{t('descriptionHelp')}</FieldDescription>
          </Field>
        </FormSection>
        {failure?.status !== 403 && failure?.status !== 404 && feedback}
      </form>
    </>}
  </Page>
}

export default function ConsolePlanCreatePage() {
  return <Guard kind="superadmin"><PlanForm /></Guard>
}
