import { StrictMode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionProvider } from '../src/shell/session'
import { PermissionsProvider } from '../src/shell/permissions'
import ConsolePostgresPage from '../src/pages/consolePostgres'
import { login } from './shell-support'
import es from '../src/locales/es/pages.console-postgres-page.json'

export const contextValue = () => ({
  activeTenantId: 't-1' as string | null, activeWorkspaceId: 'ws-1' as string | null,
  tenants: [{ tenantId: 't-1', displayName: 'Tenant Alpha' }], workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace Alpha' }],
  loading: false, error: null as { status: number } | null, selectWorkspace: (_id: string) => {}, reloadWorkspaces: async () => {},
})
export function open(roles = ['tenant_owner']) {
  const session = login(roles, ['t-1'], ['ws-1'])
  const ui = () => <StrictMode><MemoryRouter initialEntries={['/console/postgres']}><SessionProvider value={session}><PermissionsProvider><ConsolePostgresPage /></PermissionsProvider></SessionProvider></MemoryRouter></StrictMode>
  const rendered = render(ui())
  return { ...rendered, update: () => rendered.rerender(ui()) }
}
export const section = (id: string) => within(screen.getByTestId(`pg-${id}`))
export const click = (name: string, scope: Pick<ReturnType<typeof within>, 'getByRole'> = screen) => fireEvent.click(scope.getByRole('button', { name }))
export async function selectDatabase() { fireEvent.click(await section('databases').findByRole('button', { name: 'app_db' })) }
export async function selectSchema() { await selectDatabase(); fireEvent.click(await section('schemas').findByRole('button', { name: 'public' })) }
export async function selectTable() { await selectSchema(); fireEvent.click(await section('tables').findByRole('button', { name: 'accounts' })); await section('columns').findByText('gen_random_uuid()') }
export function tab(name: string) { fireEvent.click(screen.getByRole('tab', { name })) }
export async function choose(label: string, name: string) { fireEvent.click(screen.getByRole('combobox', { name: label })); const item = await screen.findByRole('option', { name }); fireEvent.pointerDown(item); fireEvent.click(item) }
export const startWizard = () => click(es.newDatabase)
export async function wizardEngine(name = ' ventas ') { startWizard(); click(es.next); fireEvent.change(screen.getByRole('textbox', { name: es.name }), { target: { value: name } }) }
