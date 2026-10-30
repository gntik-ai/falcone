import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { App } from '../src/App'
import { buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { SessionProvider } from '../src/shell/session'
import ConsoleDocs, { documentationEvents } from '../src/pages/consoleDocs'
import { fetchWorkspaceDocs, createDocNote, updateDocNote, deleteDocNote } from '../src/pages/consoleDocs/api'
import { docs, docsWorkspaces, note, createdNote, updatedNote, docsFailure, optionalDocs } from './parity/pages/console-docs-page.manifest'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-docs-page.json'
import en from '../src/locales/en/pages.console-docs-page.json'

const url = '/v1/workspaces/wrk-1/docs'
let network: ReturnType<typeof strictFetch>
const deferred = () => {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
const mount = (roles = ['workspace_admin']) => {
  const session = login(roles)
  return render(<MemoryRouter initialEntries={['/console/workspaces/wrk-1/docs']}><SessionProvider value={session}><Routes>
    <Route path="/console/workspaces/:workspaceId/docs" element={<ConsoleDocs />} />
  </Routes></SessionProvider></MemoryRouter>)
}
const ready = () => screen.findByRole('region', { name: es.authRegion })
const notes = (copy = es) => within(screen.getByLabelText(copy.notesRegion, { selector: 'section' }))
const timeline = (copy = es) => screen.getByRole('list', { name: copy.timeline })
const expand = () => fireEvent.click(screen.getByRole('button', { name: es.earlier.replace('{count}', '1') }))
beforeEach(() => {
  network = strictFetch({ [`GET ${url}`]: docs })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { network.verify(); vi.unstubAllGlobals() })

test('ports the legacy authenticated load, heading, base URL, admin affordances and author assertions', async () => {
  mount(); await ready()
  expect(screen.getByRole('heading', { name: es.title, level: 1 })).toBeVisible()
  expect(screen.getByText(docs.baseUrl)).toBeVisible()
  expect(network.mock).toHaveBeenCalledTimes(1)
  expect(network.mock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET', body: undefined }))
  expect(notes().getByLabelText(es.newNote)).toBeVisible()
  expect(notes().getByLabelText(es.editNote.replace('{noteId}', note.noteId))).toHaveValue(note.content)
  expect(notes().getAllByRole('button', { name: es.save })).toHaveLength(2)
  expect(notes().getAllByRole('button', { name: es.delete })).toHaveLength(2)
  expect(notes().getByText(note.authorId)).toBeVisible()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(await screen.findByRole('region', { name: es.notifications })).toBeInTheDocument()
})

for (const role of ['workspace_admin', 'workspace_owner', 'workspace_viewer', 'superadmin']) test(`uses only legacy note management roles for ${role}`, async () => {
  mount([role]); await ready()
  if (['workspace_admin', 'workspace_owner'].includes(role)) expect(notes().getByRole('button', { name: es.add })).toBeDisabled()
  else {
    expect(notes().getByText(note.content)).toBeVisible()
    expect(notes().getByText(es.readOnly)).toBeVisible()
    expect(notes().queryAllByRole('textbox')).toEqual([])
    for (const label of [es.add, es.save, es.delete]) expect(notes().queryByRole('button', { name: label })).not.toBeInTheDocument()
  }
})

test('announces one skeleton while the read is pending', async () => {
  const held = deferred(); network = strictFetch({ [`GET ${url}`]: () => held.promise })
  mount()
  expect(screen.getByText(es.loading).closest('[role="status"]')).toBeVisible()
  expect(screen.queryByRole('region', { name: es.authRegion })).not.toBeInTheDocument()
  await act(async () => held.resolve(Response.json(docs))); await ready()
})

for (const [locale, copy] of [['es', es], ['en', en]] as const) test(`translates controls and preserves all server fields verbatim in ${locale}`, async () => {
  await i18n.changeLanguage(locale)
  network = strictFetch({ [`GET ${url}`]: { ...docs, authInstructions: { ...docs.authInstructions, consoleRef: 'Settings' } } })
  mount(); await screen.findByRole('region', { name: copy.authRegion })
  expect(screen.getByRole('heading', { name: copy.title })).toBeVisible()
  const services = within(screen.getByRole('region', { name: copy.services }))
  expect(services.getByRole('heading', { name: copy.services, level: 2 })).toBeVisible()
  for (const service of docs.enabledServices) {
    expect(services.getByRole('heading', { name: service.label, level: 3 })).toBeVisible()
  }
  expect(screen.getAllByRole('heading').every((heading) => heading.textContent?.trim())).toBe(true)
  const auth = within(screen.getByRole('region', { name: copy.authRegion }))
  for (const value of Object.values({ ...docs.authInstructions, consoleRef: 'Settings' })) expect(auth.getByText(value!)).toBeVisible()
  for (const key of ['method', 'tokenEndpoint', 'clientId', 'clientSecret', 'scopes', 'consoleRef'] as const) expect(auth.getByText(copy[key]).tagName).toBe('DT')
  expect(screen.getByRole('button', { name: copy.refreshLabel })).toHaveTextContent(copy.refresh)
  expect(screen.getByRole('tablist', { name: copy.snippetTabs.replace('{service}', docs.enabledServices[0].label) })).toBeVisible()
  expect(notes(copy).getByRole('button', { name: copy.add })).toBeVisible()
  fireEvent.click(notes(copy).getAllByRole('button', { name: copy.delete })[0])
  expect(await screen.findByRole('alertdialog')).toBeVisible()
  expect(screen.getByRole('button', { name: copy.confirm })).toBeVisible()
  expect(screen.getByRole('button', { name: copy.cancel })).toBeVisible()
})

test('preserves snippet selection, active-only guidance and verbatim clipboard text', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const view = mount(); await ready()
  expect(screen.getByText('Synthetic secret placeholder guidance')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'Synthetic SDK example' }))
  expect(screen.queryByText('Synthetic secret placeholder guidance')).not.toBeInTheDocument()
  expect(sessionStorage.getItem('docs-snippet-tab-synthetic-sql')).toBe('synthetic-sdk')
  fireEvent.click(screen.getByRole('button', { name: es.copyLabel.replace('{label}', 'Synthetic SDK example') }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(docs.enabledServices[0].snippets[1].code))
  expect(await screen.findByRole('button', { name: es.copied })).toBeVisible()
  await waitFor(() => expect(document.querySelector('[data-live-announcer="polite"]')).toHaveTextContent(es.copied))
  view.unmount(); mount(); await ready()
  expect(screen.getByRole('tab', { name: 'Synthetic SDK example' })).toHaveAttribute('aria-selected', 'true')
})

test('hides absent token and null or zero port fields, retaining the nonzero port', async () => {
  const view = mount(); await ready()
  expect(screen.getAllByText(es.port)).toHaveLength(1)
  view.unmount(); network = strictFetch({ [`GET ${url}`]: optionalDocs }); mount(); await ready()
  expect(screen.queryByText(es.port)).not.toBeInTheDocument()
  expect(screen.queryByText(es.tokenEndpoint)).not.toBeInTheDocument()
})

test('shows no-services and no-notes states with the unchanged settings link and generation-only activity', async () => {
  network = strictFetch({ [`GET ${url}`]: { ...docs, enabledServices: [], customNotes: [] } })
  mount(); await ready()
  expect(screen.getByText(es.noServices)).toBeVisible()
  expect(screen.getByRole('link', { name: es.settings })).toHaveAttribute('href', '/console/settings')
  expect(screen.getByText(es.noNotes)).toBeVisible()
  expect(within(timeline()).getAllByRole('listitem')).toHaveLength(1)
})

test('orders only response activity newest first, collapses older events and never assigns an edit actor', async () => {
  mount(); await ready()
  expect(within(timeline()).getAllByRole('listitem')).toHaveLength(3)
  expand()
  const entries = within(timeline()).getAllByRole('listitem')
  expect(entries).toHaveLength(4)
  expect(entries.map((entry) => entry.querySelector('time')?.getAttribute('datetime'))).toEqual(['2026-06-01T11:30:00.000Z','2026-06-01T11:00:00.000Z','2026-06-01T10:00:00.000Z','2026-06-01T09:00:00.000Z'])
  expect(entries[1]).toHaveTextContent(es.noteEdited)
  expect(entries[1]).not.toHaveTextContent(note.authorId)
  expect(entries[2]).toHaveTextContent(note.authorId)
  fireEvent.click(screen.getByRole('button', { name: es.fewer }))
  expect(within(timeline()).getAllByRole('listitem')).toHaveLength(3)
  const labels = { generation: es.generation, noteCreated: es.noteCreated, noteEdited: es.noteEdited }
  expect(documentationEvents({ ...docs, generatedAt: '', customNotes: [{ ...note, createdAt: '', updatedAt: '', authorId: '' }] }, labels)).toEqual([])
  expect(documentationEvents({ ...docs, customNotes: [{ ...note, updatedAt: note.createdAt }] }, labels)).toHaveLength(2)
})

test('creates the raw draft, clears it and appends response activity without another GET', async () => {
  const held = deferred()
  network = strictFetch({ [`GET ${url}`]: docs, [`POST ${url}/notes`]: () => held.promise })
  mount(); await ready()
  const composer = notes().getByLabelText(es.newNote)
  fireEvent.change(composer, { target: { value: '   ' } })
  expect(notes().getByRole('button', { name: es.add })).toBeDisabled()
  fireEvent.change(composer, { target: { value: createdNote.content } })
  fireEvent.click(notes().getByRole('button', { name: es.add }))
  expect(notes().getByRole('button', { name: es.adding })).toBeDisabled()
  expect(notes().getAllByRole('textbox').every((input) => input.hasAttribute('disabled'))).toBe(true)
  expect(notes().getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true)
  await act(async () => held.resolve(Response.json(createdNote)))
  await waitFor(() => expect(composer).toHaveValue(''))
  expect(notes().getByLabelText(es.editNote.replace('{noteId}', createdNote.noteId))).toHaveValue(createdNote.content)
  expect(timeline()).toHaveTextContent(createdNote.noteId)
  expect(network.mock).toHaveBeenCalledTimes(2)
  expect(network.mock).toHaveBeenLastCalledWith(`${url}/notes`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ content: createdNote.content }) }))
})

test('updates from the response, adds its edit activity and sends the exact PUT payload', async () => {
  network = strictFetch({ [`GET ${url}`]: docs, [`PUT ${url}/notes/${note.noteId}`]: updatedNote })
  mount(); await ready()
  const input = notes().getByLabelText(es.editNote.replace('{noteId}', note.noteId))
  fireEvent.change(input, { target: { value: updatedNote.content } })
  fireEvent.click(notes().getAllByRole('button', { name: es.save })[0])
  await waitFor(() => expect(input).toHaveValue(updatedNote.content))
  await waitFor(() => expect(notes().queryByRole('button', { name: es.saving })).not.toBeInTheDocument())
  expect(within(timeline()).getAllByRole('listitem')[0]).toHaveTextContent(es.noteEdited)
  expect(network.mock).toHaveBeenCalledTimes(2)
  expect(network.mock).toHaveBeenLastCalledWith(`${url}/notes/${note.noteId}`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ content: updatedNote.content }) }))
})

for (const action of ['create', 'update'] as const) for (const status of [403, 500]) test(`${action} ${status} preserves the draft and links only the composer error`, async () => {
  const path = action === 'create' ? `${url}/notes` : `${url}/notes/${note.noteId}`
  network = strictFetch({ [`GET ${url}`]: docs, [`${action === 'create' ? 'POST' : 'PUT'} ${path}`]: () => Response.json(docsFailure.body, { status }) })
  mount(); await ready()
  const input = notes().getByLabelText(es.newNote)
  fireEvent.change(input, { target: { value: 'Synthetic preserved draft' } })
  fireEvent.click(action === 'create' ? notes().getByRole('button', { name: es.add }) : notes().getAllByRole('button', { name: es.save })[0])
  const alert = await notes().findByRole('alert')
  expect(alert).toHaveTextContent(es[action === 'create' ? 'createError' : 'updateError'])
  expect(input).toHaveAttribute('aria-describedby', 'workspace-doc-note-action-error')
  expect(document.getElementById('workspace-doc-note-action-error')).toContainElement(alert)
  expect(input).toHaveValue('Synthetic preserved draft')
  expect(input).not.toBeDisabled()
})

for (const action of ['cancel', 'escape'] as const) test(`delete ${action} returns focus to the original delete button`, async () => {
  mount(); await ready()
  const trigger = notes().getAllByRole('button', { name: es.delete })[0]
  trigger.focus(); fireEvent.click(trigger)
  const dialog = await screen.findByRole('alertdialog')
  if (action === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: es.cancel }))
  else fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(network.mock).toHaveBeenCalledTimes(1)
})

test('successful delete sends DELETE, drops note and timeline entries, then focuses the notes heading', async () => {
  const held = deferred()
  network = strictFetch({ [`GET ${url}`]: docs, [`DELETE ${url}/notes/${note.noteId}`]: () => held.promise })
  mount(); await ready()
  const composer = notes().getByLabelText(es.newNote), save = notes().getAllByRole('button', { name: es.save })[0]
  fireEvent.click(notes().getAllByRole('button', { name: es.delete })[0])
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: es.confirm }))
  expect(notes().getByLabelText(es.newNote)).not.toBeDisabled()
  expect(save).not.toBeDisabled()
  expect(within(dialog).getByRole('button', { name: es.confirming })).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: es.cancel })).toBeDisabled()
  await act(async () => held.resolve(Response.json({})))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(notes().queryByLabelText(es.editNote.replace('{noteId}', note.noteId))).not.toBeInTheDocument()
  expect(timeline()).not.toHaveTextContent(note.noteId)
  await waitFor(() => expect(notes().getByRole('heading', { name: es.notes })).toHaveFocus())
  expect(network.mock).toHaveBeenCalledTimes(2)
  expect(network.mock).toHaveBeenLastCalledWith(`${url}/notes/${note.noteId}`, expect.objectContaining({ method: 'DELETE', body: undefined }))
})

test('failed delete stays in the focused dialog, announces the legacy error and retains the note and timeline', async () => {
  network = strictFetch({ [`GET ${url}`]: docs, [`DELETE ${url}/notes/${note.noteId}`]: () => Response.json(docsFailure.body, { status: 500 }) })
  mount(); await ready()
  fireEvent.click(notes().getAllByRole('button', { name: es.delete })[0])
  const dialog = await screen.findByRole('alertdialog'), confirm = within(dialog).getByRole('button', { name: es.confirm })
  confirm.focus(); fireEvent.click(confirm)
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(es.delete500)
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  expect(notes().getByLabelText(es.newNote)).not.toHaveAttribute('aria-describedby')
  expect(notes().getByLabelText(es.editNote.replace('{noteId}', note.noteId))).toHaveValue(note.content)
  expect(screen.getByLabelText(es.timeline, { selector: 'ol' })).toHaveTextContent(note.noteId)
  await waitFor(() => expect(document.querySelector('[data-live-announcer="assertive"]')).toHaveTextContent(es.delete500))
})

for (const status of [403, 404, 500, 'network'] as const) test(`renders ${status} without stale data and retries the read`, async () => {
  let count = 0
  network = strictFetch({ [`GET ${url}`]: () => {
    count++
    if (count !== 2) return Response.json(docs)
    if (status === 'network') return Promise.reject(new TypeError('synthetic-network'))
    return Response.json({ ...docsFailure.body, message: 'Synthetic reason' }, { status })
  } })
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: es.refreshLabel }))
  expect(await screen.findByRole('heading', { name: status === 403 ? es.noAccess : status === 404 ? es.notFound : es.errorTitle })).toBeVisible()
  expect(screen.queryByRole('region', { name: es.authRegion })).not.toBeInTheDocument()
  expect(screen.queryByRole('list', { name: es.timeline })).not.toBeInTheDocument()
  if (status === 403) expect(screen.getByText('Synthetic reason')).toBeVisible()
  if (status === 404) expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/workspaces')
  if (status === 500) expect(screen.getByText('synthetic-docs-request')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: status === 403 || status === 404 ? es.refreshLabel : es.retry }))
  await ready(); expect(network.mock).toHaveBeenCalledTimes(3)
})

test('encodes route and note identifiers while preserving all four legacy API shapes', async () => {
  const encoded = '/v1/workspaces/wrk%20%2F1/docs'
  network = strictFetch({ [`GET ${encoded}`]: docs, [`POST ${encoded}/notes`]: createdNote, [`PUT ${encoded}/notes/note%2F1`]: updatedNote, [`DELETE ${encoded}/notes/note%2F1`]: {} })
  login(['workspace_admin'])
  await fetchWorkspaceDocs('wrk /1'); await createDocNote('wrk /1', ' raw '); await updateDocNote('wrk /1', 'note/1', ' edit '); await deleteDocNote('wrk /1', 'note/1')
  expect(network.mock.mock.calls.map(([, init]) => [init?.method, init?.body])).toEqual([['GET', undefined], ['POST', '{"content":" raw "}'], ['PUT', '{"content":" edit "}'], ['DELETE', undefined]])
})


for (const role of ['workspace_admin', 'workspace_viewer']) for (const locale of ['es', 'en']) test(`the docs parity context resolves its route workspace for ${role} in ${locale}`, async () => {
  await i18n.changeLanguage(locale)
  login([role], ['synthetic-tenant'], [docs.workspaceId])
  network = strictFetch({ [`GET ${url}`]: docs, [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: docsWorkspaces })
  render(<MemoryRouter initialEntries={['/console/workspaces/wrk-1/docs']}><App /></MemoryRouter>)
  const context = await screen.findByRole('region', { name: locale === 'es' ? 'Contexto activo' : 'Active context' })
  await waitFor(() => expect(context).toHaveAttribute('aria-busy', 'false'))
  expect(within(context).getByRole('button', { name: /^wrk-1,/ })).toBeVisible()
  expect(context).not.toHaveTextContent('Select workspace')
  expect(network.mock.mock.calls.filter(([path]) => String(path).includes('/docs')).map(([path]) => path)).toEqual([url])
})

test('the next shell honors the route workspace over stored selection, renders one linked breadcrumb and reads once', async () => {
  const session = login(['workspace_admin'], ['synthetic-tenant'], ['wrk-1', 'wrk-2'])
  localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal!.userId, tenantId: 'synthetic-tenant', workspaceId: 'wrk-2', updatedAt: '2026-06-01T12:00:00Z' }))
  const collection = buildWorkspaceCollectionFixture()
  const workspace = collection.items[0]
  collection.items = ['wrk-1', 'wrk-2'].map((id) => ({ ...workspace, workspaceId: id, displayName: id }))
  network = strictFetch({ [`GET ${url}`]: docs, [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: collection })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/workspaces/wrk-1/docs']}><App /></MemoryRouter>)
  await ready()
  const context = screen.getByRole('region', { name: 'Contexto activo' })
  await waitFor(() => expect(context).toHaveAttribute('aria-busy', 'false'))
  expect(within(context).getByRole('button', { name: /wrk-1/ })).toBeVisible()
  expect(JSON.parse(localStorage.getItem('in-falcone.console-active-context')!).workspaceId).toBe('wrk-1')
  const breadcrumb = screen.getAllByRole('navigation').filter((nav) => nav.querySelector('ol [aria-current="page"]'))
  expect(breadcrumb).toHaveLength(1)
  for (const href of ['/next/console/overview', '/console/workspaces', '/next/console/workspaces/wrk-1']) expect(breadcrumb[0].querySelector(`a[href="${href}"]`)).toBeInTheDocument()
  expect(breadcrumb[0].querySelector('[aria-current="page"]')).toHaveTextContent('Documentación')
  expect(screen.getAllByRole('heading', { level: 1, name: es.title })).toHaveLength(1)
  expect(network.mock.mock.calls.filter(([path]) => String(path).includes('/docs')).map(([path]) => path)).toEqual([url])
}, 15_000)

test('the shell refreshes a docs 401 once then preserves the next return path', async () => {
  const session = login(['workspace_admin'])
  network = strictFetch({ [`GET ${url}`]: () => Response.json({ code: 'HTTP_401', message: 'Synthetic unauthorized docs' }, { status: 401 }),
    [`GET ${tenantUrl}`]: { items: [] }, 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': session,
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/workspaces/wrk-1/docs']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })).toBeVisible()
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')!)).toBe('/next/console/workspaces/wrk-1/docs'))
  expect(network.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(network.mock.mock.calls.filter(([path]) => path === url)).toHaveLength(2)
})
