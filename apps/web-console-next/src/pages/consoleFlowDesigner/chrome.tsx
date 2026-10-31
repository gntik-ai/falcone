import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, EmptyState, Field, FieldLabel, Link, ScrollArea, SimpleSelect, Table, TableHeader, TableHead, TableRow, TableBody, TableCell, Text, useAnnounce, useToast } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, PageSkeleton, TableSkeleton } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { listTaskTypes, triggerFlowSchedule, type FlowScheduleTriggerAck } from './api'
import { useCopy } from './copy'
import { DesignerButton as Button, focus } from './controls'
import { describeFlowValidationError } from './validation-errors'
import type { TaskTypeDescriptor, ValidationError } from './flows'

export type Failure = Pick<Partial<ApiError>, 'status' | 'requestId' | 'message'>
export function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId ?? '' }
}
export function useErrorMessage() {
  const { t } = useCopy()
  return useCallback((error: unknown, fallback: string) => {
    const { status } = failureFrom(error)
    return t(status && [401, 403, 404, 409, 429].includes(status) ? `errors.${status}` : status && status >= 500 ? 'errors.server' : fallback)
  }, [t])
}
export function useNotify() {
  const announce = useAnnounce(), toast = useToast()
  const current = useRef({ announce, toast })
  current.current = { announce, toast }
  return useCallback((message: string, error = false) => {
    current.current.announce(message, error ? 'assertive' : 'polite')
    current.current.toast.add({ title: message, tone: error ? 'destructive' : 'success', priority: error ? 'high' : 'low' })
  }, [])
}
export function BackLink() {
  const { t } = useCopy()
  return <Link href="/console/flows" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('back')}</Link>
}
export function Callout({ message, warning = false }: { message: string; warning?: boolean }) {
  return <InlineCallout tone={warning ? 'warning' : 'destructive'} title={message} description="" actions={[]} labels={{ title: message, description: '', upgrade: '', viewUsage: '' }} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" />
}
export function Loading() {
  const { t } = useCopy()
  return <section role="status" aria-label={t('loading')} aria-busy={true}><h1 className="text-lg font-semibold">{t('loading')}</h1><Text variant="body" tone="muted">{t('loadingDescription')}</Text><PageSkeleton stats={0} rows={4} label={t('loading')} className="min-w-0" /></section>
}
export function LoadFailure({ error, retry }: { error: Failure; retry: () => void }) {
  const { t } = useCopy()
  if (error.status === 403) return <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
  if (error.status === 404) return <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={<BackLink />} titleAs="h2" bordered={false} className="min-w-0" />
  return <ErrorPanel title={t('errorTitle')} message={t('errorDescription')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0"
    labels={{ title: t('errorTitle'), message: t('errorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}
export function WorkspaceGate({ missingFlow = false }: { missingFlow?: boolean }) {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (!missingFlow && context.loading) return <section role="status" aria-label={t('workspaceLoading')} aria-busy={true}><h2 className="text-lg font-semibold">{t('workspaceLoading')}</h2><Text variant="body" tone="muted">{t('workspaceLoadingDescription')}</Text><TableSkeleton rows={3} columns={1} label={t('workspaceLoading')} className="min-w-0" /></section>
  if (!missingFlow && context.error) return <ErrorPanel title={t('workspaceError')} message={t('workspaceErrorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={() => void context.reloadWorkspaces?.()} className="min-w-0"
    labels={{ title: t('workspaceError'), message: t('workspaceErrorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
  return <EmptyState icon={undefined} title={t('blocked')} description={t(missingFlow ? 'missingFlow' : 'workspaceDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0" primaryAction={missingFlow ? <BackLink /> : context.workspaces.length ?
    <Field invalid={false}><FieldLabel htmlFor="designer-workspace">{t('workspace')}</FieldLabel><SimpleSelect id="designer-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link> : <Text variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}
export const FLOW_PALETTE_DRAG_MIME = 'application/x-falcone-flow-task-type'
export function FlowPalette({ workspaceId, onCatalogLoaded, onInsert }: { workspaceId: string; onCatalogLoaded: (items: TaskTypeDescriptor[]) => void; onInsert: (descriptor: TaskTypeDescriptor) => void }) {
  const { t } = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ attempt: number; items: TaskTypeDescriptor[]; error: { message?: string } | null }>({ attempt: -1, items: [], error: null })
  const request = useRef<{ attempt: number; promise: Promise<TaskTypeDescriptor[]> } | null>(null)
  useEffect(() => {
    let active = true
    if (request.current?.attempt !== attempt) request.current = { attempt, promise: listTaskTypes(workspaceId) }
    void request.current.promise.then((items) => { if (active) { setResult({ attempt, items, error: null }); onCatalogLoaded(items) } }).catch((error: unknown) => {
      if (active) setResult({ attempt, items: [], error: error instanceof Error ? { message: error.message } : {} })
    })
    return () => { active = false }
  }, [workspaceId, attempt, onCatalogLoaded])
  const drag = (event: DragEvent<HTMLButtonElement>, descriptor: TaskTypeDescriptor) => {
    event.dataTransfer.setData(FLOW_PALETTE_DRAG_MIME, JSON.stringify(descriptor)); event.dataTransfer.effectAllowed = 'move'
  }
  const byCategory = new Map<string, TaskTypeDescriptor[]>()
  for (const descriptor of result.items) { const category = descriptor.category || t('other'); byCategory.set(category, [...(byCategory.get(category) ?? []), descriptor]) }
  return <ScrollArea orientation="vertical" bordered={false} aria-label={t('palette')} aria-labelledby={undefined} viewportClassName="max-h-80" contentClassName="space-y-3 p-3" viewportRef={undefined} className="min-w-0">
    {result.attempt !== attempt ? <TableSkeleton rows={3} columns={1} label={t('paletteLoading')} className="min-w-0" />
      : result.error !== null ? <div data-testid="flow-palette-error"><Text variant="body" tone="destructive">{t('paletteError')}</Text><Text variant="supporting" tone="muted">{result.error.message ?? t('paletteErrorFallback')}</Text><Button variant="secondary" disabled={false} onClick={() => setAttempt((value) => value + 1)}>{t('retry')}</Button></div>
      : result.items.length === 0 ? <Text variant="body" tone="muted">{t('paletteEmpty')}</Text>
      : <div data-testid="flow-palette"><Text variant="supporting" tone="muted">{t('paletteHint')}</Text>{[...byCategory].map(([category, items]) => <section key={category} className="space-y-2"><h2 className="text-sm font-semibold">{category}</h2>{items.map((descriptor) =>
        <Button key={descriptor.id} variant="secondary" disabled={false} draggable={true} onDragStart={(event) => drag(event, descriptor)} onClick={() => onInsert(descriptor)} title={t('paletteHint')} data-testid={`flow-palette-item-${descriptor.id}`} className="w-full whitespace-normal">{descriptor.label}</Button>)}</section>)}</div>}
  </ScrollArea>
}
export interface FlowProblem extends ValidationError { source?: 'interaction' }
export function FlowProblemsPanel({ problems, onSelectNode }: { problems: FlowProblem[]; onSelectNode: (nodeId: string) => void }) {
  const { t, i18n } = useCopy()
  if (!problems.length) return null
  return <div data-testid="flow-problems-panel"><Table density="compact" stickyHeader={false} containerClassName="max-h-44" containerLabel={t('problemsLabel')} aria-label={t('problems', { count: problems.length })}>
    <TableHeader><TableRow><TableHead scope="col">{t('code')}</TableHead><TableHead scope="col">{t('node')}</TableHead><TableHead scope="col">{t('message')}</TableHead></TableRow></TableHeader>
    <TableBody>{problems.map((problem, index) => <TableRow key={`${problem.code}-${problem.nodeId}-${index}`} data-testid="flow-problem-entry">
      <TableCell>{problem.code}</TableCell><TableCell>{problem.nodeId ? <Button variant="ghost" disabled={false} aria-label={t('selectNode', { id: problem.nodeId })} onClick={() => onSelectNode(problem.nodeId!)}>{problem.nodeId}</Button> : t('flow')}</TableCell>
      <TableCell className="whitespace-normal wrap-anywhere">{problem.source === 'interaction' ? problem.message : describeFlowValidationError(problem, i18n.language)}</TableCell>
    </TableRow>)}</TableBody>
  </Table></div>
}
export function FlowRunTriggerButton({ workspaceId, flowId, flowName, status, onTriggered }: { workspaceId: string; flowId: string; flowName: string; status: string | undefined; onTriggered: (ack: FlowScheduleTriggerAck) => void }) {
  const { t } = useCopy(), notify = useNotify(), message = useErrorMessage()
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null), inFlight = useRef(false)
  const canRun = (status?.trim() || '').toLowerCase() === 'published'
  async function confirm() {
    if (inFlight.current || !canRun) return
    inFlight.current = true; setPending(true); setError('')
    try { const ack = await triggerFlowSchedule(workspaceId, flowId); notify(t('runStarted')); setOpen(false); onTriggered(ack) }
    catch (cause) { const text = message(cause, 'runError'); setError(text); notify(text, true); setOpen(false) }
    finally { setPending(false); inFlight.current = false }
  }
  return <><Button ref={trigger} variant="primary" disabled={!canRun || pending} title={!canRun ? t('runBlocked') : undefined} aria-label={t(canRun ? 'runNamed' : 'runDisabled', { name: flowName, reason: t('runBlocked') })} data-testid="flow-run-now-button" onClick={() => setOpen(true)}>{t(pending ? 'running' : 'run')}</Button>
    {error && <Text variant="supporting" tone="destructive" data-testid="flow-run-now-error">{error}</Text>}
    <AlertDialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next) }}><AlertDialogContent size="sm" container={undefined} finalFocus={trigger} className="min-w-0 wrap-anywhere" data-testid="confirm-action-dialog">
      <AlertDialogHeader tone="info" icon={null}><AlertDialogTitle>{t('runTitle')}</AlertDialogTitle><AlertDialogDescription>{t('runDescription', { name: flowName })}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><Button variant="secondary" disabled={pending} data-testid="confirm-action-cancel" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button disabled={pending} data-testid="confirm-action-confirm" onClick={() => void confirm()}>{t(pending ? 'running' : 'run')}</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog></>
}
