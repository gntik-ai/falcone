import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { login } from './shell-support'
import i18n from '../src/i18n'
import { copy, element, open, patchContext, serve, workspaceContext } from './consoleWorkspaceDatabase-support'
import { databasePath, dsn, hint, password, reason, record, requestId, rotationPath, unknownReason } from './parity/pages/console-workspace-database-page.manifest'
import { Result } from '../src/pages/consoleWorkspaceDatabase/Results'
import { notRotatedKey } from '../src/pages/consoleWorkspaceDatabase/copy'

let server: ReturnType<typeof serve>
const click = (name: string, scope: HTMLElement = document.body) => fireEvent.click(within(scope).getByRole('button', { name }))
const ready = () => screen.findByText(record.database_name, { selector: 'dd *' })
const dialog = () => screen.getByRole('alertdialog')
const writes = () => server.scenario.calls.filter(({ method }) => method === 'POST')
const typed = () => within(dialog()).getByLabelText(copy().typedName) as HTMLInputElement
const setName = (value = record.database_name) => fireEvent.change(typed(), { target: { value } })
const confirm = async () => {
  click(copy().rotate); setName(); click(copy().confirm, dialog())
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
}
const result = () => document.querySelector<HTMLElement>('[data-database-result]')!
const outcome = () => screen.getByTestId('database-outcome')
const protectedCopyIsAbsent = () => {
  const nodes = document.querySelectorAll('[data-live-announcer], [data-toast-root], [role="status"], [role="alert"]')
  expect([...nodes].every((node) => [dsn, password, record.username, hint, reason, unknownReason].every((value) => !node.textContent?.includes(value)))).toBe(true)
}
const assertMasked = () => {
  expect((screen.getByTestId('database-dsn') as HTMLInputElement).value.includes(dsn)).toBe(false)
  expect((screen.getByTestId('database-password') as HTMLInputElement).value.includes(password)).toBe(false)
}
afterEach(() => server?.verify())
for (const locale of ['es', 'en']) describe(locale, () => {
  beforeEach(async () => { await i18n.changeLanguage(locale); login(); workspaceContext() })
  test('renders legacy fields and exactly one factual creation event', async () => {
    server = serve('workspace-database.get.success'); open(); await ready()
    for (const value of [record.host, String(record.port), record.username]) expect(screen.getByText(value)).toBeVisible()
    for (const key of ['engine', 'mode', 'status'] as const) expect(screen.getByLabelText(`${copy()[key]}: ${record[key]}`)).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: copy().history }))
    const history = screen.getByRole('list', { name: copy().history })
    expect(within(history).getAllByRole('listitem')).toHaveLength(1)
    expect(within(history).getByText(copy().created)).toBeVisible()
    expect(history.querySelector('time')).toHaveAttribute('datetime', new Date(record.created_at).toISOString())
    expect(screen.getByText(copy().historyUnavailable)).toBeVisible()
    expect(server.scenario.calls).toEqual([{ method: 'GET', path: databasePath, body: undefined }])
  })
  test('loading shows skeletons without mutation controls', async () => {
    let release!: () => void
    server = serve('workspace-database.get.delayed', { method: 'GET', release: new Promise((resolve) => { release = resolve }) })
    open(); expect(screen.getByLabelText(copy().loading)).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: copy().rotate })).not.toBeInTheDocument()
    await act(async () => { release() }); await ready(); expect(server.scenario.calls).toHaveLength(1)
  })
  test('arrow keys focus and activate the history and summary tabs', async () => {
    server = serve('workspace-database.get.success'); open(); await ready()
    const summary = screen.getByRole('tab', { name: copy().summary })
    const history = screen.getByRole('tab', { name: copy().history })
    act(() => summary.focus())
    fireEvent.keyDown(summary, { key: 'ArrowRight' })
    await waitFor(() => expect(history).toHaveFocus())
    expect(history).toHaveAttribute('aria-selected', 'true')
    expect(summary).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('list', { name: copy().history })).toBeVisible()
    fireEvent.keyDown(history, { key: 'ArrowLeft' })
    await waitFor(() => expect(summary).toHaveFocus())
    expect(summary).toHaveAttribute('aria-selected', 'true')
    expect(history).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText(record.database_name, { selector: 'dd *' })).toBeVisible()
    expect(server.scenario.calls).toEqual([{ method: 'GET', path: databasePath, body: undefined }])
  })
  test('first run provisions once under double click and focuses the masked reveal', async () => {
    let release!: () => void
    server = serve('workspace-database.provision.dedicated', { method: 'POST', release: new Promise((resolve) => { release = resolve }) })
    open(); const button = await screen.findByRole('button', { name: copy().provision })
    expect(screen.queryByRole('tab')).not.toBeInTheDocument(); fireEvent.click(button); fireEvent.click(button)
    expect(button).toBeDisabled(); await waitFor(() => expect(writes()).toHaveLength(1))
    await act(async () => { release() }); await waitFor(() => expect(result()).toHaveFocus())
    assertMasked(); expect(writes()).toEqual([{ method: 'POST', path: databasePath, body: {} }]); protectedCopyIsAbsent()
    const toggle = screen.getAllByRole('button', { name: copy().show })[0]
    expect(toggle).toHaveAttribute('aria-pressed', 'false'); fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect((screen.getByTestId('database-dsn') as HTMLInputElement).value === dsn).toBe(true)
  })
  test('shared provisioning uses translated copy and collapsed technical details', async () => {
    server = serve('workspace-database.provision.shared'); open(); await screen.findByRole('button', { name: copy().provision }); click(copy().provision)
    await waitFor(() => expect(result()).toHaveFocus()); expect(screen.getByText(copy().shared)).toBeVisible()
    expect(screen.queryByTestId('database-password')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: copy().details }); expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(hint)).not.toBeInTheDocument(); fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(await screen.findByText(hint)).toBeVisible(); protectedCopyIsAbsent()
  })
  test('typed confirmation rejects mismatches; cancel and Escape restore focus without requests', async () => {
    server = serve('workspace-database.get.success'); open(); await ready()
    for (const cancel of ['button', 'escape']) {
      click(copy().rotate); setName(`${record.database_name} `)
      expect(within(dialog()).getByRole('button', { name: copy().confirm })).toBeDisabled()
      if (cancel === 'button') click(copy().cancel, dialog()); else fireEvent.keyDown(typed(), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      await waitFor(() => expect(screen.getByRole('button', { name: copy().rotate })).toHaveFocus())
    }
    expect(writes()).toEqual([])
  })
  test('rotation double click sends one empty POST and focuses its safe outcome', async () => {
    let release!: () => void
    server = serve('workspace-database.rotate.success', { method: 'POST', release: new Promise((resolve) => { release = resolve }) })
    open(); await ready(); click(copy().rotate); setName()
    const button = within(dialog()).getByRole('button', { name: copy().confirm }); fireEvent.click(button); fireEvent.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true'); expect(screen.getByText(copy().processing, { selector: 'button' })).toBeDisabled()
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()).toEqual([{ method: 'POST', path: rotationPath, body: {} }])
    await act(async () => { release() }); await waitFor(() => expect(result()).toHaveFocus()); assertMasked(); protectedCopyIsAbsent()
  })
  test.each(['not-rotated', 'not-rotated-unknown-reason'])('maps %s without displaying the raw reason', async (kind) => {
    server = serve(`workspace-database.rotate.${kind}`); open(); await ready(); await confirm()
    await waitFor(() => expect(result()).toHaveFocus())
    expect(within(result()).getByText(kind === 'not-rotated' ? copy().notRotated : copy().notRotatedFallback)).toBeVisible()
    const raw = kind === 'not-rotated' ? reason : unknownReason
    expect(screen.queryByText(raw)).not.toBeInTheDocument(); click(copy().details); expect(await screen.findByText(raw)).toBeVisible(); protectedCopyIsAbsent()
  })
  test('409 shared mode focuses its legacy message and announces assertively', async () => {
    server = serve('workspace-database.rotate.409-db-shared-mode'); open(); await ready(); await confirm()
    await waitFor(() => expect(document.querySelector('[data-database-message]')).toHaveFocus())
    expect(within(outcome()).getByText(copy().sharedConflict)).toBeVisible(); protectedCopyIsAbsent()
  })
  for (const status of [403, 500, 'network'] as const) test(`GET ${status} replaces the record and retries the read`, async () => {
    server = serve(`workspace-database.get.${status}`); open(); await screen.findByRole('alert')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument(); expect(screen.queryByText(record.database_name)).not.toBeInTheDocument()
    if (status === 500) expect(screen.getByText(requestId)).toBeVisible()
    click(status === 403 ? copy().reload : copy().retry)
    await waitFor(() => expect(server.scenario.calls).toHaveLength(2))
    expect(server.scenario.calls.every(({ method, path }) => method === 'GET' && path === databasePath)).toBe(true)
  })
  for (const operation of ['provision', 'rotate'] as const) for (const status of [403, 404, 500, 'network'] as const) test(`${operation} ${status} keeps the state and offers the correct safe retry`, async () => {
    server = serve(`workspace-database.${operation}.${status}`); open()
    if (operation === 'provision') { await screen.findByRole('button', { name: copy().provision }); click(copy().provision) } else { await ready(); await confirm() }
    const panel = await within(outcome()).findByRole('alert'), title = status === 403 || status === 404
    await waitFor(() => expect(title ? panel.querySelector('h2') : within(panel).getByRole('button', { name: copy().retry })).toHaveFocus())
    expect(screen.queryByTestId('database-password')).not.toBeInTheDocument()
    if (operation === 'provision') expect(screen.getByRole('button', { name: copy().provision })).toBeVisible(); else await ready()
    if (status === 500) expect(within(panel).getByText(requestId)).toBeVisible(); protectedCopyIsAbsent()
    click(title ? copy().reload : copy().retry, panel)
    if (title) {
      await waitFor(() => expect(server.scenario.calls.filter(({ method }) => method === 'GET')).toHaveLength(2))
      await waitFor(() => expect(operation === 'provision' ? screen.getByRole('button', { name: copy().provision }) : screen.getByRole('heading', { level: 1 })).toHaveFocus())
      expect(writes()).toHaveLength(1)
    } else if (operation === 'rotate') {
      expect(typed().value).toBe(''); expect(within(dialog()).getByRole('button', { name: copy().confirm })).toBeDisabled(); expect(writes()).toHaveLength(1)
    } else await waitFor(() => expect(writes()).toHaveLength(2))
  })
  test.each(['provision', 'rotate'])('%s transient recovery never bypasses typed confirmation', async (operation) => {
    server = serve(`workspace-database.${operation}.500-then-success`); open()
    if (operation === 'provision') { await screen.findByRole('button', { name: copy().provision }); click(copy().provision) } else { await ready(); await confirm() }
    await within(outcome()).findByRole('button', { name: copy().retry }); click(copy().retry, outcome())
    if (operation === 'rotate') { setName(); click(copy().confirm, dialog()) }
    await waitFor(() => expect(result()).toHaveFocus()); assertMasked(); expect(writes()).toHaveLength(2)
  })
  test('later errors and workspace switches discard revealed credentials', async () => {
    server = serve('workspace-database.rotate.success'); const view = open(); await ready(); await confirm(); assertMasked()
    server = serve('workspace-database.rotate.403'); await confirm(); await within(outcome()).findByRole('alert')
    expect(screen.queryByTestId('database-dsn')).not.toBeInTheDocument()
    patchContext({ activeWorkspaceId: null }); view.rerender(element())
    expect(screen.getByText(copy().noWorkspace)).toBeVisible(); expect(screen.queryByText(record.database_name)).not.toBeInTheDocument()
  })
  test('unmount during a mutation discards its response', async () => {
    let release!: () => void
    server = serve('workspace-database.provision.dedicated', { method: 'POST', release: new Promise((resolve) => { release = resolve }) })
    const view = open(); await screen.findByRole('button', { name: copy().provision }); click(copy().provision)
    patchContext({ activeWorkspaceId: null }); view.rerender(element()); await act(async () => { release() })
    expect(screen.queryByTestId('database-dsn')).not.toBeInTheDocument(); expect(screen.getByText(copy().noWorkspace)).toBeVisible()
  })
  test('workspace loading and errors send no database request; retry uses the context once', () => {
    server = serve('shell.workspaces-loading'); workspaceContext({ activeWorkspaceId: null, loading: true })
    const view = open(); expect(screen.getByRole('status', { name: copy().workspace.loading })).toHaveTextContent(copy().workspace.loading); expect(server.mock).not.toHaveBeenCalled()
    const reloadWorkspaces = vi.fn(); patchContext({ loading: false, error: { status: 500 }, reloadWorkspaces }); view.rerender(element())
    expect(screen.getByRole('alert')).toHaveTextContent(copy().workspace.error)
    expect(within(screen.getByRole('alert')).getByRole('button', { name: copy().retry })).toBeVisible()
    click(copy().retry); expect(reloadWorkspaces).toHaveBeenCalledTimes(1); expect(server.mock).not.toHaveBeenCalled()
  })
  test('workspace picker uses the shell setter and selects exactly once', async () => {
    server = serve('shell.no-active-workspace'); const selectWorkspace = vi.fn(() => patchContext({ activeWorkspaceId: 'synthetic-workspace' }))
    workspaceContext({ activeWorkspaceId: null, selectWorkspace }); const view = open(); expect(server.mock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('combobox', { name: copy().workspace.label })); fireEvent.click(await screen.findByRole('option', { name: 'Synthetic Workspace' }))
    expect(selectWorkspace).toHaveBeenCalledWith('synthetic-workspace'); view.rerender(element()); await ready(); expect(server.scenario.calls).toHaveLength(1)
  })
  test.each(['tenant_owner', 'tenant_viewer'])('workspace create permission for %s is preserved', (role) => {
    server = serve(`shell.no-workspaces-${role === 'tenant_owner' ? 'owner' : 'viewer'}`); workspaceContext({ activeWorkspaceId: null, workspaces: [] }, [role]); open()
    if (role === 'tenant_owner') expect(screen.getByRole('link', { name: copy().workspace.create })).toHaveAttribute('href', '/console/workspaces')
    else { expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(screen.getByText(copy().workspace.denied)).toBeVisible() }
    expect(server.mock).not.toHaveBeenCalled()
  })
})
test('known shared reason and mode map locally; unknown dedicated reasons use the fallback', () => {
  expect(notRotatedKey('shared', unknownReason)).toBe('notRotated'); expect(notRotatedKey('dedicated_role', reason)).toBe('notRotated')
  expect(notRotatedKey('dedicated_role', undefined)).toBe('notRotated'); expect(notRotatedKey('dedicated_role', unknownReason)).toBe('notRotatedFallback')
})

test('a not-rotated response never reveals optional stale credential fields', () => {
  render(<Result connection={null} rotation={{ databaseId: record.id, rotated: false, dsn, password }} />)
  expect(screen.queryByTestId('database-dsn')).not.toBeInTheDocument()
  expect(screen.queryByTestId('database-password')).not.toBeInTheDocument()
})
