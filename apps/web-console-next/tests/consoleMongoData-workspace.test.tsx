import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import { calls, open, setup, state } from './consoleMongoData-support'

let server: ReturnType<typeof setup>
afterEach(async () => { server?.verify(); await changeLocale('es') })
const noRequests = () => expect(calls(server)).toEqual([])

// Literal copy per locale: the assertions must not read the catalogs they verify.
const copy = {
  es: { loading: 'Cargando áreas de trabajo', required: 'Selecciona un área de trabajo para editar datos.', retry: 'Reintentar', picker: 'Seleccionar área de trabajo', create: 'Crear área de trabajo', denied: /todavía no tiene áreas de trabajo/, database: 'Base de datos', collection: 'Colección' },
  en: { loading: 'Loading workspaces', required: 'Select a workspace to edit data.', retry: 'Retry', picker: 'Select workspace', create: 'Create workspace', denied: /has no workspaces yet/, database: 'Database', collection: 'Collection' }
} as const
const locales = [['es'], ['en']] as const
const noWorkspace = async (locale: keyof typeof copy, patch: Record<string, unknown> = {}) => { server = setup(); await changeLocale(locale); Object.assign(state.context, { activeWorkspaceId: null, ...patch }) }

// Ports apps/web-console ConsoleMongoDataPage.test.tsx:41-65 (the #742 workspace-required states), in es and en.
test.each(locales)('%s: loading renders the loading state and sends no request', async (locale) => {
  const words = copy[locale]; await noWorkspace(locale, { loading: true }); open()
  expect(screen.getByRole('heading', { name: words.loading })).toBeVisible(); expect(screen.queryByText(words.required)).toBeNull(); noRequests()
})
test.each(locales.flatMap(([locale]) => [403, 500, undefined].map((status) => [locale, status] as const)))('%s: workspace load error %s keeps the retry button, which calls reloadWorkspaces once', async (locale, status) => {
  const words = copy[locale]; const reloadWorkspaces = vi.fn(); await noWorkspace(locale, { error: { status }, reloadWorkspaces }); open()
  fireEvent.click(screen.getByRole('button', { name: words.retry })); expect(reloadWorkspaces).toHaveBeenCalledTimes(1); expect(screen.getByTestId('mongodata-failure-workspace')).toBeVisible(); noRequests()
})
test.each(locales)('%s: the picker selects a workspace through selectWorkspace and sends nothing', async (locale) => {
  const words = copy[locale]; const selectWorkspace = vi.fn(); await noWorkspace(locale, { selectWorkspace, workspaces: [{ workspaceId: 'wrk_1', displayName: 'Producción' }, { workspaceId: 'wrk_2', displayName: 'Staging' }] }); open()
  expect(screen.getByText(words.required)).toBeVisible()
  fireEvent.click(screen.getByRole('combobox', { name: words.picker })); const option = await screen.findByRole('option', { name: 'Staging' }); fireEvent.pointerDown(option); fireEvent.click(option)
  expect(selectWorkspace).toHaveBeenCalledWith('wrk_2'); noRequests()
})
test.each(locales)('%s: with no workspaces the create link shows only with the permission, otherwise the denial note', async (locale) => {
  const words = copy[locale]; await noWorkspace(locale, { workspaces: [] }); const view = open()
  expect(screen.getByRole('link', { name: words.create })).toHaveAttribute('href', '/console/workspaces'); noRequests(); view.unmount()
  state.allowed = false; open()
  expect(screen.queryByRole('link', { name: words.create })).toBeNull(); expect(screen.getByText(words.denied)).toBeVisible(); noRequests()
})
test.each(locales)('%s: the target fields and the editor are not rendered without an active workspace', async (locale) => {
  const words = copy[locale]; await noWorkspace(locale, { workspaces: [] }); open()
  expect(screen.queryByLabelText(words.database)).toBeNull(); expect(screen.queryByLabelText(words.collection)).toBeNull(); expect(screen.queryByTestId('mongodata-editor')).toBeNull(); noRequests()
})
