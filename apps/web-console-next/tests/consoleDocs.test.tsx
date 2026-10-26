import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, NavLink, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import ConsoleDocsPage, { timelineEvents } from '../src/pages/consoleDocs'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { docs, docsPath, docsFixtures, note, createdNote, updatedNote } from './parity/pages/consoleDocs.manifest'
import type { WorkspaceDocsResponse } from '../src/pages/consoleDocs/api'
import { buildConsoleRefreshSessionFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-docs-page.json'
import en from '../src/locales/en/pages.console-docs-page.json'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
function mock(response: unknown = docs, extra: Record<string, unknown> = {}) {
  requests = strictFetch({ [`GET ${docsPath}`]: response, ...extra })
}
function open(role = 'workspace_admin', strict = false) {
  login([role])
  const page = <MemoryRouter initialEntries={['/console/workspaces/wrk-1/docs']}><Routes><Route path="/console/workspaces/:workspaceId/docs" element={<ConsoleDocsPage />} /></Routes></MemoryRouter>
  return render(strict ? <StrictMode>{page}</StrictMode> : page)
}
const settled = () => screen.findByRole('button', { name: i18n.language === 'es' ? es.refreshLabel : en.refreshLabel })
const docsCalls = () => requests.mock.mock.calls.filter(([path]) => String(path) === docsPath)
const noteArticle = () => screen.getByRole('textbox', { name: es.editNote.replace('{note}', note.noteId) }).closest('article')!
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

// This fixture intentionally uses Settings. Keep verbatim-data checks separate from assertLocale.
test.each(['es', 'en'] as const)('ports legacy rendering and byte-identical server values in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const value = docsFixtures.verbatim.body as WorkspaceDocsResponse
  mock(value); open(); await settled()
  expect(screen.getByRole('heading', { name: copy.title })).toBeVisible()
  expect(screen.getByRole('region', { name: copy.authRegion })).toBeVisible()
  expect(screen.getByRole('region', { name: copy.servicesRegion })).toBeVisible()
  for (const key of ['method', 'tokenEndpoint', 'clientIdPlaceholder', 'clientSecretPlaceholder', 'scopeHint', 'consoleRef', 'category', 'port'] as const) expect(screen.getAllByText(copy[key]).every((element) => element.textContent === copy[key])).toBe(true)
  for (const serverValue of [value.baseUrl, ...Object.values(value.authInstructions), 'PostgreSQL', value.enabledServices[0].endpoint, 'synthetic-data', 'const x = 1']) {
    expect(screen.getAllByText(serverValue!, { exact: true }).length).toBeGreaterThan(0)
  }
  const time = screen.getByText(new Date(value.generatedAt).toLocaleString(locale))
  expect(time).toBeVisible()
  expect(screen.getByRole('textbox', { name: copy.newNote })).toBeVisible()
  expect(screen.getByRole('textbox', { name: copy.editNote.replace('{note}', note.noteId) })).toHaveValue(note.content)
  expect(screen.getByRole('button', { name: copy.add })).toBeDisabled()
  expect(screen.getAllByRole('button', { name: copy.save })).toHaveLength(2)
  expect(screen.getAllByRole('button', { name: copy.delete })).toHaveLength(2)
  expect(docsCalls()).toHaveLength(1)
  expect(docsCalls()[0][1]).toMatchObject({ method: 'GET', body: undefined })
})

test.each(['workspace_admin', 'workspace_owner'])('only the legacy management roles can mutate: %s', async (role) => {
  mock(); open(role, true); await settled()
  expect(screen.getByRole('textbox', { name: es.newNote })).toBeVisible()
  expect(docsCalls()).toHaveLength(1)
})
test.each(['workspace_viewer', 'superadmin', 'tenant_owner'])('read-only controls are absent for %s', async (role) => {
  mock(); open(role); await settled()
  expect(screen.getByText(note.content)).toBeVisible()
  expect(screen.getByText(es.readOnly)).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  for (const name of [es.add, es.save, es.delete]) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  expect(screen.getByRole('list', { name: es.timeline })).toBeVisible()
})

test('optional fields, empty services, notes and timeline preserve legacy conditions', async () => {
  const value = docsFixtures['optional-fields-absent'].body as WorkspaceDocsResponse
  mock(value); const view = open(); await settled()
  expect(screen.queryByText(es.tokenEndpoint)).not.toBeInTheDocument()
  expect(screen.queryByText(es.port)).not.toBeInTheDocument()
  view.unmount()
  mock({ ...docs, enabledServices: [], customNotes: [] }); open(); await settled()
  expect(screen.getByRole('heading', { name: es.noNotes })).toBeVisible()
  expect(screen.getByRole('heading', { name: es.noServices })).toBeVisible()
  expect(screen.getByRole('link', { name: es.settings })).toHaveAttribute('href', '/console/settings')
  expect(screen.getByRole('region', { name: es.authRegion })).toBeVisible()
  expect(within(screen.getByRole('list', { name: es.timeline })).getAllByRole('listitem')).toHaveLength(1)
})

test.each(['es', 'en'] as const)('tab selection, secret guidance, copy feedback and timeline collapse use catalog labels in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const clipboard = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: clipboard } })
  mock(); const view = open(); await settled()
  expect(screen.getByRole('tablist', { name: copy.snippets.replace('{service}', 'PostgreSQL') })).toBeVisible()
  expect(screen.getByText('synthetic-secret-reference')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: copy.copy }))
  await screen.findByRole('button', { name: copy.copied })
  expect(clipboard).toHaveBeenCalledWith('const x = 1')
  fireEvent.click(screen.getByRole('tab', { name: 'Python' }))
  expect(screen.queryByText('synthetic-secret-reference')).not.toBeInTheDocument()
  expect(sessionStorage.getItem('docs-snippet-tab-postgres-database')).toBe('s2')
  const timeline = screen.getByRole('list', { name: copy.timeline })
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(3)
  const expand = screen.getByRole('button', { name: copy.earlier.replace('{count}', '1') })
  fireEvent.click(expand)
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(4)
  fireEvent.click(screen.getByRole('button', { name: copy.fewer }))
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(3)
  view.unmount(); open(); await settled()
  expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByText('synthetic-secret-reference')).not.toBeInTheDocument()
})

test('timeline derives only supplied events, sorts newest first and never attributes an edit', () => {
  const labels = { generated: 'generated', created: 'created', edited: 'edited' }
  const events = timelineEvents(docs, labels)
  expect(events.map((event) => event.id)).toEqual(['note-2-edited', 'note-2-created', 'note-1-created', 'generated'])
  expect(events[0]).not.toHaveProperty('actor')
  expect(events[1].actor).toBe(docs.customNotes[1].authorId)
  expect(timelineEvents({ ...docs, generatedAt: '', customNotes: [{ ...note, createdAt: '', updatedAt: '' }] }, labels)).toEqual([])
})

test.each(['es', 'en'] as const)('create and update pending controls, payloads, success and local timeline in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const create = deferred(), update = deferred()
  mock(docs, { [`POST ${docsPath}/notes`]: () => create.promise, [`PUT ${docsPath}/notes/note-1`]: () => update.promise })
  open(); await settled()
  const composer = screen.getByRole('textbox', { name: copy.newNote })
  fireEvent.change(composer, { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: copy.add })).toBeDisabled()
  fireEvent.change(composer, { target: { value: ' synthetic new note ' } })
  fireEvent.click(screen.getByRole('button', { name: copy.add }))
  expect(screen.getByRole('button', { name: copy.adding })).toBeDisabled()
  for (const input of screen.getAllByRole('textbox')) expect(input).toBeDisabled()
  for (const name of [copy.save, copy.delete]) for (const button of screen.getAllByRole('button', { name })) expect(button).toBeDisabled()
  await act(async () => create.resolve(Response.json(createdNote)))
  expect(composer).toHaveValue('')
  expect(requests.mock.mock.calls.find(([path, init]) => path === `${docsPath}/notes` && init?.method === 'POST')?.[1]?.body).toBe(JSON.stringify({ content: ' synthetic new note ' }))
  expect(screen.getByRole('textbox', { name: copy.editNote.replace('{note}', 'note-3') })).toHaveValue(createdNote.content)
  const edit = screen.getByRole('textbox', { name: copy.editNote.replace('{note}', note.noteId) })
  fireEvent.change(edit, { target: { value: updatedNote.content } })
  fireEvent.click(within(edit.closest('article')!).getByRole('button', { name: copy.save }))
  expect(screen.getByRole('button', { name: copy.saving })).toBeDisabled()
  await act(async () => update.resolve(Response.json(updatedNote)))
  expect(edit).toHaveValue(updatedNote.content)
  expect(requests.mock.mock.calls.find(([path, init]) => path === `${docsPath}/notes/note-1` && init?.method === 'PUT')?.[1]?.body).toBe(JSON.stringify({ content: updatedNote.content }))
  expect(docsCalls()).toHaveLength(1)
  expect(screen.getByRole('list', { name: copy.timeline })).toHaveTextContent(copy.noteEdited)
})

test.each(['es', 'en'] as const)('create/update errors stay in composer and preserve drafts in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  mock(docs, { [`POST ${docsPath}/notes`]: () => Response.json({ code: 'HTTP_500' }, { status: 500 }), [`PUT ${docsPath}/notes/note-1`]: () => Response.json({ code: 'FORBIDDEN' }, { status: 403 }) })
  open(); await settled()
  const composer = screen.getByRole('textbox', { name: copy.newNote })
  fireEvent.change(composer, { target: { value: 'keep draft' } }); fireEvent.click(screen.getByRole('button', { name: copy.add }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.createError))
  expect(composer).toHaveAttribute('aria-describedby', 'workspace-doc-note-action-error')
  expect(composer).toHaveValue('keep draft')
  const edit = screen.getByRole('textbox', { name: copy.editNote.replace('{note}', note.noteId) })
  fireEvent.change(edit, { target: { value: 'keep edit' } })
  fireEvent.click(within(edit.closest('article')!).getByRole('button', { name: copy.save }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.updateError))
  expect(edit).toHaveValue('keep edit')
  expect(docsCalls()).toHaveLength(1)
})

describe('delete focus and isolated pending state', () => {
  test.each(['cancel', 'escape'])('%s returns focus to the same Delete control', async (action) => {
    mock(); open(); await settled()
    const trigger = within(noteArticle()).getByRole('button', { name: es.delete })
    trigger.focus(); fireEvent.click(trigger)
    const dialog = await screen.findByRole('alertdialog')
    if (action === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: es.cancel }))
    else fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
  test('success removes note and timeline locally and focuses notes heading', async () => {
    mock(docs, { [`DELETE ${docsPath}/notes/note-1`]: () => new Response(null, { status: 204 }) })
    open(); await settled()
    fireEvent.click(within(noteArticle()).getByRole('button', { name: es.delete }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: es.confirm }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { name: es.notes })).toHaveFocus())
    expect(screen.queryByRole('textbox', { name: 'Editar note-1' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: es.timeline })).not.toHaveTextContent('note-1')
    const call = requests.mock.mock.calls.find(([path, init]) => path === `${docsPath}/notes/note-1` && init?.method === 'DELETE')
    expect(call?.[1]?.body).toBeUndefined()
    expect(docsCalls()).toHaveLength(1)
  })
  test.each(['es', 'en'] as const)('failure keeps focus and translated error in dialog, not composer, in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    const copy = locale === 'es' ? es : en
    const response = deferred()
    mock(docs, { [`DELETE ${docsPath}/notes/note-1`]: () => response.promise })
    open(); await settled()
    const edit = screen.getByRole('textbox', { name: copy.editNote.replace('{note}', note.noteId) })
    fireEvent.click(within(edit.closest('article')!).getByRole('button', { name: copy.delete }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: copy.cancel })).toBeEnabled()
    const confirm = within(dialog).getByRole('button', { name: copy.confirm })
    confirm.focus(); fireEvent.click(confirm)
    expect(within(dialog).getByRole('button', { name: copy.confirming })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: copy.cancel })).toBeDisabled()
    for (const input of document.querySelectorAll('textarea')) expect(input).not.toBeDisabled()
    for (const button of edit.closest('article')!.querySelectorAll('button')) expect(button).not.toBeDisabled()
    await act(async () => response.resolve(Response.json({ code: 'HTTP_500' }, { status: 500 })))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(copy.deleteUnavailable)
    expect(screen.getByRole('textbox', { name: copy.newNote, hidden: true })).not.toHaveAttribute('aria-describedby')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(edit).toHaveValue(note.content)
    expect(screen.getByRole('list', { name: copy.timeline, hidden: true })).toHaveTextContent(note.noteId)
    expect(docsCalls()).toHaveLength(1)
  })
})

test('loading is announced once; refresh sends one new GET and network error discards stale content', async () => {
  const response = deferred()
  let count = 0
  mock(() => { if (++count === 1) return response.promise; throw new TypeError('offline') })
  open(); expect(screen.getAllByRole('status').filter((node) => node.textContent?.includes(es.loading))).toHaveLength(1)
  await act(async () => response.resolve(Response.json(docs)))
  fireEvent.click(await settled())
  await screen.findByRole('button', { name: es.retry })
  expect(screen.queryByText('bearer_oidc')).not.toBeInTheDocument()
  expect(screen.queryByRole('list', { name: es.timeline })).not.toBeInTheDocument()
  expect(docsCalls()).toHaveLength(2)
})

test.each([403, 404, 500])('GET %s renders the required state, request id and retry behavior', async (status) => {
  let count = 0
  mock(() => ++count === 1 ? Response.json({ code: `HTTP_${status}`, message: 'synthetic-denial', requestId: 'synthetic-docs-request' }, { status }) : Response.json(docs))
  open()
  await screen.findByRole('heading', { name: status === 403 ? es.noAccess : status === 404 ? es.notFound : es.errorTitle })
  if (status === 403) {
    expect(screen.getByText('synthetic-denial')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  } else if (status === 404) expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/workspaces')
  else {
    expect(screen.getByText('synthetic-docs-request')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: es.retry })); await settled()
    expect(docsCalls()).toHaveLength(2)
  }
})

test('real shell deep link gives route workspace precedence, one GET and only shell breadcrumbs', async () => {
  const session = login(['workspace_admin'])
  const tenants = buildTenantCollectionFixture(), workspaces = buildWorkspaceCollectionFixture()
  const workspace = workspaces.items[0]
  const first = { ...workspace, workspaceId: 'wrk-1', displayName: 'Workspace one', tenantId: tenants.items[0].tenantId }
  localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: session.principal!.userId, tenantId: first.tenantId, workspaceId: 'wrk-2', updatedAt: new Date().toISOString() }))
  requests = strictFetch({ [`GET ${docsPath}`]: docs, [`GET ${tenantUrl}`]: tenants, [`GET ${workspaceUrl(first.tenantId)}`]: { items: [first, { ...first, workspaceId: 'wrk-2', displayName: 'Workspace two' }] } })
  render(<StrictMode><MemoryRouter initialEntries={['/console/workspaces/wrk-1/docs']}><App /></MemoryRouter></StrictMode>)
  await settled()
  await waitFor(() => expect(screen.getByRole('region', { name: 'Contexto activo' })).toHaveAttribute('aria-busy', 'false'))
  expect(screen.getByRole('region', { name: 'Contexto activo' })).toHaveTextContent('Workspace one')
  expect(screen.getAllByRole('navigation', { name: /Ruta de navegación/i })).toHaveLength(1)
  const breadcrumb = screen.getByRole('navigation', { name: /Ruta de navegación/i })
  expect(Array.from(breadcrumb.querySelectorAll('a'), (node) => node.getAttribute('href'))).toEqual(['/console/overview', '/console/workspaces', '/console/workspaces/wrk-1'])
  expect(breadcrumb.querySelector('[aria-current="page"]')).toHaveTextContent('Documentación')
  expect(screen.queryByText(/pendiente de migración/i)).not.toBeInTheDocument()
  expect(docsCalls()).toHaveLength(1)
})

test.each(['rejected', 'refresh-ok', 'after-refresh'])('401 uses the existing session refresh and redirect: %s', async (variant) => {
  login(['workspace_admin'])
  let count = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, [`GET ${docsPath}`]: () => ++count === 2 && variant === 'refresh-ok' ? Response.json(docs) : Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/workspaces/wrk-1/docs']}><App /></MemoryRouter>)
  if (variant === 'refresh-ok') await settled()
  else {
    expect(await screen.findByRole('heading', { name: 'Acceso' }, { timeout: 3000 })).toBeVisible()
    expect(readProtectedRouteIntent()).toBe('/next/console/workspaces/wrk-1/docs')
  }
  expect(docsCalls()).toHaveLength(variant === 'rejected' ? 1 : 2)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
})

function DocsEntry() {
  return <NavLink to="/console/workspaces/wrk-1/docs">Workspace docs fixture link</NavLink>
}
test('a workspace link enters the lazy docs route without losing shell navigation', async () => {
  login(['workspace_admin'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, [`GET ${docsPath}`]: docs })
  render(<MemoryRouter initialEntries={['/console/workspaces/wrk-1']}><DocsEntry /><App /></MemoryRouter>)
  await screen.findByRole('navigation', { name: 'Navegación de consola' })
  fireEvent.click(screen.getByRole('link', { name: 'Workspace docs fixture link' }))
  await settled()
  expect(screen.getByRole('heading', { name: es.title })).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible()
  expect(docsCalls()).toHaveLength(1)
})
