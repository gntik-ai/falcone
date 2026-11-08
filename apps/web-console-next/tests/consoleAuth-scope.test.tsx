import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { useConsoleContext } from '../src/shell/context'
import { applicationPath, applicationsGet, collection, portal, providersPath, workspace } from './parity/pages/console-auth-page.manifest'
import { accepted, applicationReads, calls, copy, fill, open, pageCalls, ready, realmKey } from './consoleAuth-support'

let requests: ReturnType<typeof open>['requests']
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())

const secondWorkspace = { ...workspace, workspaceId: 'synthetic-workspace-2', displayName: 'Second workspace' }
const secondApplications = `GET /v1/workspaces/${secondWorkspace.workspaceId}/applications?limit=100`
// With several workspaces the shell starts without one, so the test picks each explicitly.
function SwitchWorkspace() {
  const { selectWorkspace } = useConsoleContext()
  return <>
    <button type="button" onClick={() => selectWorkspace(workspace.workspaceId)}>pick-first</button>
    <button type="button" onClick={() => selectWorkspace(secondWorkspace.workspaceId)}>pick-second</button>
  </>
}
const c = copy.es

test('a workspace change keeps the realm data and the selected client, and reloads only the applications', async () => {
  await i18n.changeLanguage('es')
  ;({ requests } = open({ shell: { more: [secondWorkspace] }, routes: { [secondApplications]: collection([]) }, aside: <SwitchWorkspace /> }))
  const clients = await screen.findByRole('table', { name: c.clients.table })
  fireEvent.click(screen.getByRole('button', { name: 'pick-first' }))
  await ready('es')
  fireEvent.click(within(clients).getByRole('button', { name: 'partner-api' }))
  expect(screen.getByText(/client_id=partner-api/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'pick-second' }))
  expect(await screen.findByText(c.apps.empty)).toBeVisible()
  const realmReads = pageCalls(requests).filter(({ path }) => path.startsWith('/v1/iam/'))
  expect(realmReads).toHaveLength(4)
  for (const section of ['users', 'roles', 'scopes', 'clients']) expect(realmReads.filter(({ path }) => `GET ${path}` === realmKey(section))).toHaveLength(1)
  expect(screen.getByText(/client_id=partner-api/)).toBeVisible()
  expect(applicationReads(requests)).toHaveLength(1)
  expect(calls(requests).filter(({ path }) => path === secondApplications.slice(4))).toHaveLength(1)
})

test('a successful provider toggle keeps an unsaved provider draft and an unsaved application draft', async () => {
  const providerPath = `${providersPath(portal.applicationId)}/corp-oidc`
  await i18n.changeLanguage('es')
  ;({ requests } = open({ routes: { [`PUT ${providerPath}`]: accepted } }))
  await ready('es')
  fireEvent.click(screen.getByRole('button', { name: fill(c.apps.providersNamed, { name: 'Portal Clientes' }) }))
  await screen.findByText(fill(c.panel.title, { name: 'Portal Clientes' }))
  fireEvent.click(screen.getByRole('button', { name: fill(c.panel.editNamed, { alias: 'Corp OIDC' }) }))
  const name = () => screen.getByLabelText(new RegExp(`^${c.provider.displayName}`)) as HTMLInputElement
  fireEvent.change(name(), { target: { value: 'Unsaved draft' } })
  fireEvent.click(screen.getByRole('button', { name: fill(c.panel.disableNamed, { alias: 'Corp OIDC' }) }))
  await waitFor(() => expect(applicationReads(requests)).toHaveLength(2))
  expect((await screen.findAllByText(fill(c.feedback.providerToggled, { alias: 'Corp OIDC' }))).length).toBeGreaterThan(0)
  await waitFor(() => expect(screen.getByRole('button', { name: fill(c.panel.disableNamed, { alias: 'Corp OIDC' }) })).toBeEnabled())
  expect(name().value).toBe('Unsaved draft')
  expect(pageCalls(requests).filter(({ method }) => method !== 'GET')).toHaveLength(1)
  expect(applicationPath(portal.applicationId)).toBeTruthy(); expect(applicationsGet).toContain('limit=100')
})

test('each realm total shows its own skeleton while its read is pending and keeps the completed tiles', async () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  await i18n.changeLanguage('es')
  ;({ requests } = open({ routes: { [realmKey('users')]: async () => { await gate; return Response.json(collection([{ userId: 'synthetic-user' }])) } } }))
  expect(await screen.findByRole('table', { name: c.scopes.table })).toBeVisible()
  expect(screen.getByRole('status', { name: fill(c.kpi.loadingNamed, { label: c.kpi.users }) })).toHaveAttribute('aria-busy', 'true')
  await waitFor(() => expect(screen.queryByRole('status', { name: fill(c.kpi.loadingNamed, { label: c.kpi.roles }) })).toBeNull())
  expect(screen.getByLabelText(c.sections.roles)).toHaveTextContent('2')
  expect(screen.getByLabelText(c.kpi.label)).toHaveAttribute('aria-busy', 'true')
  release()
  await waitFor(() => expect(screen.queryByRole('status', { name: fill(c.kpi.loadingNamed, { label: c.kpi.users }) })).toBeNull())
  expect(screen.getByLabelText(c.sections.users)).toHaveTextContent('1')
  expect(screen.getByLabelText(c.kpi.label)).toHaveAttribute('aria-busy', 'false')
})
