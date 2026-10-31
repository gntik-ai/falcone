import { StrictMode, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConsoleFlowDesignerPage from '../src/pages/consoleFlowDesigner'
import { getFlow, listTaskTypes, updateFlowDraft, publishFlow, triggerFlowSchedule } from '../src/pages/consoleFlowDesigner/api'
import { flowRecord, flowPath, taskTypesPath, taskTypes, versionPath, triggerPath, serverErrors } from './parity/pages/console-flow-designer-page.manifest'
import { FLOW_PALETTE_DRAG_MIME } from '../src/pages/consoleFlowDesigner/chrome'
import { nodesToDefinition, definitionToNodes, definitionToEdges } from '../src/pages/consoleFlowDesigner/flowGraphModel'
import { serializeFlowToYaml, parseYamlToFlow } from '../src/pages/consoleFlowDesigner/yaml-serialiser'
import { evaluateConnection } from '../src/pages/consoleFlowDesigner/connectionRules'
import { describeFlowValidationError } from '../src/pages/consoleFlowDesigner/validation-errors'
import { runFlowSemantics } from '../src/pages/consoleFlowDesigner/semantic-validation-core'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-flow-designer-page.json'
import en from '../src/locales/en/pages.console-flow-designer-page.json'
const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => false }) }))
vi.mock('../src/pages/consoleFlowDesigner/MonacoYamlSurface', () => ({ default: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => <textarea aria-label={i18n.t('yamlLabel', { ns: 'pages.console-flow-designer-page' })} value={value} onChange={(event) => onChange(event.target.value)} /> }))
vi.mock('@xyflow/react', async (original) => {
  const real = await original<typeof import('@xyflow/react')>()
  return { ...real, ReactFlowProvider: ({ children }: { children: ReactNode }) => children, Handle: () => null,
    ReactFlow: ({ children, nodes, edges, nodeTypes }: { children: ReactNode; nodes: import('@xyflow/react').Node[]; edges: import('@xyflow/react').Edge[]; nodeTypes: Record<string, React.ComponentType<any>> }) => <div data-testid="react-flow-stub">{nodes.map((node) => { const Component = nodeTypes[node.type!]; return <div key={node.id} role="button" tabIndex={0} className="react-flow__node" data-id={node.id} aria-label={node.ariaLabel} {...node.domAttributes}><Component data={node.data} selected={node.selected} /></div> })}<output data-testid="edges">{edges.length}</output>{children}</div>,
    Background: () => null, Controls: () => null, useReactFlow: () => ({ screenToFlowPosition: (point: { x: number; y: number }) => point }) }
})
let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([url, init]) => ({ path: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }))
function setup(routes: Record<string, unknown> = {}) {
  requests = strictFetch({ [`GET ${flowPath}`]: flowRecord, [`GET ${taskTypesPath}`]: { items: taskTypes }, [`PATCH ${flowPath}`]: flowRecord, [`POST ${versionPath}`]: { flowId: 'f1', version: 2 }, [`POST ${triggerPath}`]: { status: 'triggered', scheduleId: 'synthetic-schedule' }, ...routes })
}
function Probe() { const location = useLocation(); return <output data-testid="location">{location.pathname}{JSON.stringify(location.state)}</output> }
function open(path = '/console/flows/f1') { return render(<StrictMode><MemoryRouter initialEntries={[path]}><Routes><Route path="/console/flows/:flowId" element={<ConsoleFlowDesignerPage />} /><Route path="/missing" element={<ConsoleFlowDesignerPage />} /><Route path="/console/flows/:flowId/runs" element={<Probe />} /></Routes></MemoryRouter></StrictMode>) }
async function ready() { await screen.findByRole('heading', { name: flowRecord.name }); await screen.findByTestId('flow-palette-item-synthetic-task') }
beforeEach(() => { Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] }); login(); context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, workspaces: [], selectWorkspace: vi.fn() } })
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('ports the legacy header, all node kinds and history navigation in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready()
  const copy = locale === 'es' ? es : en
  expect(screen.getByRole('tablist', { name: copy.view })).toBeVisible()
  expect(screen.getByRole('tab', { name: copy.canvas })).toBeVisible()
  expect(screen.getAllByTestId('flow-node-shell')).toHaveLength(7)
  expect(screen.getByTestId('edges')).toHaveTextContent('9')
  expect(screen.getByRole('link', { name: i18n.t('historyNamed', { ns: 'pages.console-flow-designer-page', name: flowRecord.name }) })).toHaveAttribute('href', '/console/flows/f1/runs')
  expect(calls()).toEqual([{ path: flowPath, method: 'GET', body: undefined }, { path: taskTypesPath, method: 'GET', body: undefined }])
  expect(screen.getByTestId('flow-run-now-button')).toBeDisabled()
})

test('keeps graph projection, every edge kind and YAML round trips identical to legacy', () => {
  const definition = flowRecord.definition!
  const projected = nodesToDefinition(definition, definitionToNodes(definition), definitionToEdges(definition))
  expect(projected).toEqual(definition)
  expect(parseYamlToFlow(serializeFlowToYaml(projected))).toEqual(projected)
  expect(new Set(definitionToEdges(definition).map((edge) => edge.data?.kind))).toEqual(new Set(['next', 'step', 'branch', 'arm', 'default']))
  expect(runFlowSemantics({ yaml: serializeFlowToYaml(definition), taskTypeCatalog: ['synthetic-task'] }).markers).toEqual([])
})

test('five API operations preserve encoded paths, methods, payloads and raw PATCH versus normalized publish 422', async () => {
  const encoded = '/v1/flows/workspaces/synthetic%2Fworkspace/flows/f%2F1'
  setup({ [`GET ${encoded}`]: flowRecord, 'GET /v1/flows/workspaces/synthetic%2Fworkspace/task-types': { items: taskTypes }, [`PATCH ${encoded}`]: () => Response.json({ errors: serverErrors }, { status: 422 }), [`POST ${encoded}/versions`]: () => Response.json({ errors: serverErrors }, { status: 422 }), [`POST ${encoded}/schedule/trigger`]: { status: 'triggered', scheduleId: 'synthetic-schedule' } })
  await getFlow('synthetic/workspace', 'f/1'); await listTaskTypes('synthetic/workspace')
  await expect(updateFlowDraft('synthetic/workspace', 'f/1', { definition: flowRecord.definition! })).rejects.toMatchObject({ status: 422, errors: serverErrors })
  await expect(publishFlow('synthetic/workspace', 'f/1')).rejects.toMatchObject({ status: 422, body: { errors: serverErrors } })
  await triggerFlowSchedule('synthetic/workspace', 'f/1')
  expect(calls().map(({ method }) => method)).toEqual(['GET', 'GET', 'PATCH', 'POST', 'POST'])
  expect(calls()[2].body).toEqual({ definition: flowRecord.definition })
  expect(calls()[3].body).toBeUndefined(); expect(calls()[4].body).toBeUndefined()
})

test('keyboard palette insertion is focused and persisted in the next PATCH, then save is announced', async () => {
  setup(); open(); await ready()
  const palette = screen.getByTestId('flow-palette-item-synthetic-task'); palette.focus(); fireEvent.click(palette)
  await waitFor(() => expect(screen.getAllByTestId('flow-node-shell')).toHaveLength(8))
  await waitFor(() => expect(document.activeElement).toHaveAttribute('data-id', 'synthetic-task-1'))
  fireEvent.click(screen.getByTestId('save-draft-button'))
  await screen.findByTestId('saved-indicator')
  expect(calls().find(({ method }) => method === 'PATCH')?.body.definition.nodes).toContainEqual({ id: 'synthetic-task-1', type: 'task', taskType: 'synthetic-task', input: {} })
  expect(screen.queryByTestId('unsaved-changes-indicator')).toBeNull()
  expect(screen.getAllByText(es.saved).length).toBeGreaterThan(1)
})

test('drag palette insertion uses the legacy MIME and canvas coordinates', async () => {
  setup(); open(); await ready()
  const data = new Map<string, string>(); const dataTransfer = { types: [FLOW_PALETTE_DRAG_MIME], setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? '', effectAllowed: '' }
  fireEvent.dragStart(screen.getByTestId('flow-palette-item-synthetic-task'), { dataTransfer })
  expect(JSON.parse(data.get(FLOW_PALETTE_DRAG_MIME)!)).toEqual(taskTypes[0])
  fireEvent.drop(screen.getByRole('region', { name: es.canvas }), { dataTransfer, clientX: 45, clientY: 60 })
  await waitFor(() => expect(screen.getAllByTestId('flow-node-shell')).toHaveLength(8))
  expect(screen.getByTestId('unsaved-changes-indicator')).toBeVisible()
})

test('node Enter focuses the inspector, editing marks dirty, Escape returns focus, and revert re-GETs', async () => {
  setup(); open(); await ready()
  const node = screen.getByRole('button', { name: 'Tarea: synthetic-task' }); node.focus(); fireEvent.keyDown(node, { key: 'Enter' })
  const heading = await screen.findByRole('heading', { name: 'Propiedades del nodo: Tarea' })
  await waitFor(() => expect(heading).toHaveFocus())
  fireEvent.change(screen.getByLabelText(es.name), { target: { value: 'Renamed' } })
  expect(screen.getByTestId('unsaved-changes-indicator')).toBeVisible()
  fireEvent.keyDown(screen.getByLabelText(es.name), { key: 'Escape' }); await waitFor(() => expect(node).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: es.revert }))
  await waitFor(() => expect(calls().filter(({ path, method }) => path === flowPath && method === 'GET')).toHaveLength(2))
  await waitFor(() => expect(screen.queryByTestId('unsaved-changes-indicator')).toBeNull())
})

test('publish saves first, then posts versions and announces the pinned version', async () => {
  setup(); open(); await ready(); fireEvent.click(screen.getByTestId('publish-button'))
  expect(await screen.findByTestId('published-version-badge')).toHaveTextContent('v2 publicada')
  expect(calls().slice(-2).map(({ method, path }) => [method, path])).toEqual([['PATCH', flowPath], ['POST', versionPath]])
  expect(screen.getByTestId('flow-run-now-button')).toBeEnabled()
})

test('PATCH 422 keeps dirty state and the canvas undecorated and never publishes', async () => {
  setup({ [`PATCH ${flowPath}`]: () => Response.json({ errors: serverErrors }, { status: 422 }) }); open(); await ready()
  fireEvent.click(screen.getByTestId('flow-palette-item-synthetic-task')); fireEvent.click(screen.getByTestId('publish-button'))
  expect(await screen.findByTestId('designer-error-banner')).toHaveTextContent(es.requestFailed)
  expect(screen.getByTestId('unsaved-changes-indicator')).toBeVisible()
  expect(screen.queryByTestId('flow-node-error-badge')).toBeNull()
  expect(calls().some(({ path }) => path === versionPath)).toBe(false)
})

test('publish 422 merges structured node errors and safe flow-level Problems with accessible descriptions', async () => {
  setup({ [`POST ${versionPath}`]: () => Response.json({ errors: serverErrors }, { status: 422 }) }); open(); await ready(); fireEvent.click(screen.getByTestId('publish-button'))
  expect(await screen.findByTestId('flow-problems-panel')).toHaveTextContent('FLW-E007')
  expect(screen.getByTestId('flow-node-error-badge')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Tarea: synthetic-task' })).toHaveAttribute('aria-description', expect.stringContaining('Tipo de tarea desconocido'))
  expect(screen.getByTestId('designer-error-banner')).toHaveTextContent(es.validationFailed)
  expect(screen.queryByText('Never display raw backend diagnostics')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Seleccionar nodo task' }))
  await waitFor(() => expect(document.activeElement).toHaveAttribute('data-id', 'task'))
})

test('invalid YAML prevents PATCH and canvas switching and shows the degradation banner', async () => {
  setup(); open(); await ready(); fireEvent.click(screen.getByRole('tab', { name: es.yaml }))
  const editor = await screen.findByRole('textbox', { name: es.yamlLabel }); fireEvent.change(editor, { target: { value: 'nodes: [broken' } })
  await screen.findByTestId('designer-yaml-degraded-banner'); fireEvent.click(screen.getByTestId('save-draft-button'))
  expect(await screen.findByTestId('designer-error-banner')).toHaveTextContent(es.invalidYaml)
  fireEvent.click(screen.getByRole('tab', { name: es.canvas })); expect(screen.getByRole('tab', { name: es.yaml })).toHaveAttribute('aria-selected', 'true')
  expect(calls().some(({ method }) => method === 'PATCH')).toBe(false)
})

test('fresh draft, empty catalogue and loading skeleton have explicit states', async () => {
  setup({ [`GET ${flowPath}`]: { ...flowRecord, definition: {} }, [`GET ${taskTypesPath}`]: { items: [] } }); open()
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  expect(await screen.findByText(es.paletteEmpty)).toBeVisible(); expect(screen.getByRole('heading', { name: es.emptyCanvas })).toBeVisible()
})

test.each([403, 404, 500, 0])('load %s renders an appropriate state with retry and request diagnostics', async (status) => {
  let attempt = 0
  setup({ [`GET ${flowPath}`]: () => { if (++attempt > 1) return Response.json(flowRecord); if (!status) throw new TypeError('synthetic network'); return Response.json({ requestId: 'req_synthetic_designer', message: 'raw server text' }, { status }) } }); open()
  if (status === 403) await screen.findByRole('heading', { name: es.noAccess })
  else if (status === 404) { await screen.findByRole('heading', { name: es.notFound }); expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/flows') }
  else { await screen.findByRole('heading', { name: es.errorTitle }); if (status) expect(screen.getByText('req_synthetic_designer')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: es.retry })); await ready() }
  expect(screen.queryByText('raw server text')).toBeNull()
})

test.each([403, 500, 0])('save %s uses localized copy and retains dirty canvas state', async (status) => {
  setup({ [`PATCH ${flowPath}`]: () => { if (!status) throw new TypeError('synthetic network'); return Response.json({ message: 'requires superadmin' }, { status }) } }); open(); await ready()
  fireEvent.click(screen.getByTestId('save-draft-button'))
  const banner = await screen.findByTestId('designer-error-banner')
  expect(banner).toHaveTextContent(status === 403 ? es.errors['403'] : status ? es.errors.server : es.requestFailed)
  expect(screen.getAllByTestId('flow-node-shell')).toHaveLength(7); expect(screen.getByTestId('unsaved-changes-indicator')).toBeVisible()
  expect(screen.queryByText('requires superadmin')).toBeNull()
})

test.each(['/console/flows/f1', '/missing'])('no workspace or missing flowId makes zero page requests for %s', (route) => {
  context.value.activeWorkspaceId = null; setup(); open(route)
  expect(screen.getByRole('heading', { name: es.blocked })).toBeVisible()
  expect(calls()).toEqual([])
})

test('run-now requires confirmation, cancel restores focus, and trigger navigates with the notice', async () => {
  setup({ [`GET ${flowPath}`]: { ...flowRecord, status: 'published' } }); open(); await ready()
  const trigger = screen.getByRole('button', { name: 'Ejecutar ahora Synthetic flow' }); trigger.focus(); fireEvent.click(trigger)
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('confirm-action-cancel'))
  await waitFor(() => expect(trigger).toHaveFocus()); expect(calls().some(({ path }) => path === triggerPath)).toBe(false)
  fireEvent.click(trigger); fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('confirm-action-confirm'))
  expect(await screen.findByTestId('location')).toHaveTextContent('/console/flows/f1/runs')
  expect(screen.getByTestId('location')).toHaveTextContent('synthetic-schedule')
  expect(calls().at(-1)).toEqual({ method: 'POST', path: triggerPath, body: undefined })
})

test('post-blueprint formatter keeps interaction details and safely localizes unknown or incomplete diagnostics', () => {
  const nodes = definitionToNodes(flowRecord.definition!), edges = definitionToEdges(flowRecord.definition!)
  expect(evaluateConnection({ source: 'task', target: 'task' }, nodes, edges).code).toBe('SELF_LOOP')
  expect(evaluateConnection({ source: 'wait', target: 'parallel' }, nodes, edges).code).toBe('FLW-E002')
  expect(describeFlowValidationError(serverErrors[0], 'es')).toContain('"synthetic-task"')
  expect(describeFlowValidationError({ code: 'FLW-E006', nodeId: null }, 'en')).toBe(en.validation['FLW-E006'])
  expect(describeFlowValidationError({ code: 'UNKNOWN', nodeId: null }, 'en')).toBe(en.validationUnknown)
})


test('locale changes preserve unsaved graph edits without issuing another load', async () => {
  setup(); open(); await ready()
  fireEvent.click(screen.getByTestId('flow-palette-item-synthetic-task'))
  await act(async () => { await i18n.changeLanguage('en') })
  expect(screen.getAllByTestId('flow-node-shell')).toHaveLength(8)
  expect(screen.getByTestId('unsaved-changes-indicator')).toHaveTextContent(en.unsaved)
  expect(calls().filter(({ method, path }) => method === 'GET' && path === flowPath)).toHaveLength(1)
})

test('palette failures are localized and retry only the catalogue request', async () => {
  let attempt = 0
  setup({ [`GET ${taskTypesPath}`]: () => ++attempt === 1 ? Response.json({ message: 'raw palette backend message' }, { status: 500 }) : Response.json({ items: taskTypes }) }); open()
  const palette = await screen.findByTestId('flow-palette-error')
  expect(palette).toHaveTextContent(es.paletteError); expect(screen.queryByText('raw palette backend message')).toBeNull()
  fireEvent.click(within(palette).getByRole('button', { name: es.retry })); await screen.findByTestId('flow-palette-item-synthetic-task')
  expect(calls().filter(({ path }) => path === taskTypesPath)).toHaveLength(2)
  expect(calls().filter(({ path }) => path === flowPath)).toHaveLength(1)
})

test('semantic YAML markers block publish and reverting drops the edited YAML buffer', async () => {
  setup(); open(); await ready(); fireEvent.click(screen.getByRole('tab', { name: es.yaml }))
  const editor = await screen.findByRole('textbox', { name: es.yamlLabel })
  fireEvent.change(editor, { target: { value: 'apiVersion: v1.0\nname: Synthetic\nnodes:\n  - id: unknown\n    type: task\n    taskType: missing' } })
  await waitFor(() => expect(screen.getByTestId('publish-button')).toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: es.revert }))
  await waitFor(() => expect(editor).toHaveValue(serializeFlowToYaml(flowRecord.definition!)))
  expect(calls().filter(({ method }) => method === 'PATCH')).toHaveLength(0)
})


test('workspace loading and errors keep the legacy retry action without page traffic', async () => {
  setup(); context.value.activeWorkspaceId = null; context.value.loading = true
  const view = open(); expect(screen.getByRole('status', { name: es.workspaceLoading })).toBeVisible(); expect(calls()).toEqual([])
  view.unmount(); context.value.loading = false; context.value.error = { status: 500 }; context.value.reloadWorkspaces = vi.fn()
  open(); await screen.findByRole('heading', { name: es.workspaceError })
  fireEvent.click(screen.getByRole('button', { name: es.retry })); expect(context.value.reloadWorkspaces).toHaveBeenCalledOnce(); expect(calls()).toEqual([])
})
