import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { adaGroups, adaId, adaRoles, firstUsers, groupsPath, groups3, listOf, rolesPath, roles4, userPath, usersPath, users23 } from './parity/pages/console-iam-access-page.manifest'
import { calls, choose, copy, created, current, failure, fill, open, openTab, search, selectUser, setup, table, writes } from './consoleIamAccess-support'
import { useConsoleContext } from '../src/shell/context'

vi.mock('../src/shell/context', () => ({ useConsoleContext: vi.fn() }))
vi.mocked(useConsoleContext)
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => current()?.verify())

// Synthetic test-only value; it must never reach the DOM text, toasts, announcements or logs.
const secret = 'synthetic-temporary-secret'
const c = copy.es
const newUser = { id: 'synthetic-new', userId: 'synthetic-new', username: 'grace', email: 'grace@example.test', enabled: true, state: 'active' }
const form = () => within(screen.getByTestId('iam-create-user-form'))
const usernameField = () => form().getByRole('textbox', { name: new RegExp(`^${c.forms.user.username}`) })
const reads = (from: number) => calls().slice(from).filter(({ method }) => method === 'GET').map(({ path }) => path)
const sequence = (...responses: unknown[]) => { let index = 0; return () => Response.json(responses[Math.min(index++, responses.length - 1)]) }
const detail = (id: string) => ({ [`GET ${userPath(id)}/roles`]: listOf([]), [`GET ${userPath(id)}/groups`]: listOf([]) })
async function fillUser() {
  await table()
  fireEvent.change(usernameField(), { target: { value: ' grace ' } })
  fireEvent.change(form().getByRole('textbox', { name: c.forms.user.email }), { target: { value: 'grace@example.test' } })
  fireEvent.change(form().getByLabelText(c.forms.user.password, { selector: 'input' }), { target: { value: secret } })
  await choose(c.forms.user.role, 'editor')
}
const submitUser = () => fireEvent.click(form().getByRole('button', { name: c.forms.user.submit }))
const dialog = () => screen.findByRole('alertdialog')
const isDisabled = (element: HTMLElement) => element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'

test('create user posts the legacy body, reloads, selects the new user and focuses its row', async () => {
  setup({ [`GET ${firstUsers}`]: sequence(listOf(users23), listOf([newUser, ...users23])), [`POST ${usersPath}`]: created({ userId: 'synthetic-new' }), ...detail('synthetic-new') }); open()
  await fillUser()
  const password = form().getByLabelText(c.forms.user.password, { selector: 'input' })
  expect(password).toHaveAttribute('type', 'password')
  submitUser()
  const row = await screen.findByRole('button', { name: 'grace' })
  await waitFor(() => expect(row).toHaveFocus()); expect(row).toHaveAttribute('aria-pressed', 'true')
  expect(writes()).toEqual([{ method: 'POST', path: usersPath, body: { enabled: true, emailVerified: true, username: 'grace', email: 'grace@example.test', bootstrapCredentials: { temporaryPassword: secret }, realmRoles: ['editor'] } }])
  expect(await screen.findByRole('heading', { name: fill(c.detail.heading, { name: 'grace' }) })).toBeVisible()
  expect(await screen.findAllByText(c.success.userCreated)).not.toHaveLength(0)
  expect(document.body.textContent).not.toContain(secret)
  expect(form().getByLabelText(c.forms.user.password, { selector: 'input' })).toHaveValue('')
  expect(calls().filter(({ path }) => path === firstUsers)).toHaveLength(2)
})

test('a created user on another page is revealed so its row can take focus', async () => {
  const late = { ...newUser, username: 'zzz-late' }
  setup({ [`GET ${firstUsers}`]: sequence(listOf(users23), listOf([...users23, late])), [`POST ${usersPath}`]: created({ id: 'synthetic-new' }), ...detail('synthetic-new') }); open()
  await table(); fireEvent.change(usernameField(), { target: { value: 'zzz-late' } }); submitUser()
  const row = await screen.findByRole('button', { name: 'zzz-late' })
  await waitFor(() => expect(row).toHaveFocus())
})

test('create user with a malformed email is blocked by native validation and sends no request', async () => {
  setup({}); open(); await table()
  fireEvent.change(usernameField(), { target: { value: 'grace' } })
  fireEvent.change(form().getByRole('textbox', { name: c.forms.user.email }), { target: { value: 'not-an-email' } })
  submitUser()
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(writes()).toEqual([])
})

test('create user without an id in the response focuses the username field', async () => {
  setup({ [`POST ${usersPath}`]: created({}) }); open(); await table()
  fireEvent.change(usernameField(), { target: { value: 'grace' } }); submitUser()
  await waitFor(() => expect(usernameField()).toHaveFocus())
  expect(await screen.findAllByText(c.success.userCreated)).not.toHaveLength(0)
})

test('create user 409 keeps the values, shows the error and focuses the username', async () => {
  setup({ [`POST ${usersPath}`]: failure(409) }); open()
  await fillUser(); submitUser()
  expect(await screen.findByText(c.mutationError.title)).toBeVisible()
  expect(screen.getByText(c.errors.status['409'])).toBeVisible()
  await waitFor(() => expect(usernameField()).toHaveFocus())
  expect(usernameField()).toHaveValue(' grace '); expect(form().getByLabelText(c.forms.user.password, { selector: 'input' })).toHaveValue(secret)
  expect(calls().filter(({ path }) => path === firstUsers)).toHaveLength(1)
  expect(document.body.textContent).not.toContain(secret)
})

test('create user stays disabled while the username is empty and while a mutation runs', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`POST ${usersPath}`]: async () => { await held; return Response.json({}, { status: 201 }) } }); open(); await table()
  expect(form().getByRole('button', { name: c.forms.user.submit })).toBeDisabled()
  fireEvent.change(usernameField(), { target: { value: 'grace' } }); submitUser()
  await waitFor(() => expect(isDisabled(screen.getByRole('button', { name: c.users.reload }))).toBe(true))
  expect(isDisabled(screen.getByRole('button', { name: fill(c.users.suspendNamed, { name: 'ada' }) }))).toBe(true)
  expect(isDisabled(within(screen.getByTestId('iam-create-role-form')).getByRole('button'))).toBe(true)
  await act(async () => { release(); await held })
  await waitFor(() => expect(isDisabled(screen.getByRole('button', { name: c.users.reload }))).toBe(false))
})

test.each([['role', rolesPath, 'roleName', c.forms.role, 'roleCreated'], ['group', groupsPath, 'name', c.forms.group, 'groupCreated']] as const)('create %s reloads the catalogue, keeps the selection and focuses the name field', async (_, path, field, labels, success) => {
  setup({ [`POST ${path}`]: created({}) }); open(); await selectUser()
  const before = calls().length, formId = path === rolesPath ? 'iam-create-role-form' : 'iam-create-group-form'
  fireEvent.change(within(screen.getByTestId(formId)).getByRole('textbox', { name: new RegExp(`^${labels.name}`) }), { target: { value: ' team ' } })
  fireEvent.click(within(screen.getByTestId(formId)).getByRole('button', { name: labels.submit }))
  const input = within(screen.getByTestId(formId)).getByRole('textbox', { name: new RegExp(`^${labels.name}`) })
  await waitFor(() => expect(input).toHaveFocus())
  expect(calls().slice(before)[0]).toEqual({ method: 'POST', path, body: { [field]: 'team' } })
  expect(reads(before).sort()).toEqual([firstUsers, groupsPath, rolesPath].sort())
  expect(screen.getByRole('heading', { name: fill(c.detail.heading, { name: 'ada' }) })).toBeVisible()
  expect(await screen.findAllByText(fill(c.success[success], { name: 'team' }))).not.toHaveLength(0)
})

test('a continuation failure after a successful create shows the catalogue error panel', async () => {
  setup({ [`POST ${rolesPath}`]: created({}), [`GET ${firstUsers}`]: sequence(listOf(users23)) }); open(); await table()
  current().mock.mockImplementation(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${String(input)}`
    if (key === `POST ${rolesPath}`) return Response.json({}, { status: 201 })
    if (key === `GET ${firstUsers}`) return Response.json({ items: users23, page: { after: 'synthetic-cursor' } })
    if (key === `GET ${firstUsers}&page%5Bafter%5D=synthetic-cursor`) return Response.json({ code: 'HTTP_502' }, { status: 502 })
    return Response.json(key.includes('roles') ? listOf(roles4) : listOf(groups3))
  })
  fireEvent.change(within(screen.getByTestId('iam-create-role-form')).getByRole('textbox', { name: new RegExp(`^${c.forms.role.name}`) }), { target: { value: 'team' } })
  fireEvent.click(within(screen.getByTestId('iam-create-role-form')).getByRole('button', { name: c.forms.role.submit }))
  expect(await screen.findByRole('heading', { name: c.catalogError.title })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
})

test.each([['row'], ['detail']])('suspend from the %s PATCHes enabled false, reloads and returns focus to the status button', async (where) => {
  setup({ [`PATCH ${userPath(adaId)}/status`]: created({}, 200) }); open(); await selectUser()
  const before = calls().length
  fireEvent.click(where === 'row' ? screen.getByRole('button', { name: fill(c.users.suspendNamed, { name: 'ada' }) }) : screen.getByRole('button', { name: c.detail.suspend }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toEqual({ method: 'PATCH', path: `${userPath(adaId)}/status`, body: { enabled: false } })
  await waitFor(() => expect(reads(before).sort()).toEqual([firstUsers, groupsPath, rolesPath].sort()))
  await waitFor(() => expect(document.activeElement).toHaveAttribute('data-focus-key', where === 'row' ? `status-user-row-${adaId}` : `status-user-detail-${adaId}`))
  expect((await screen.findAllByText(c.success.suspended)).length).toBeGreaterThan(0)
})

test('enabling a suspended user sends enabled true', async () => {
  const suspended = { ...users23[0], enabled: false, state: 'suspended' }
  setup({ [`GET ${firstUsers}`]: listOf([suspended, ...users23.slice(1)]), [`PATCH ${userPath(adaId)}/status`]: created({}, 200) }); open(); await table()
  fireEvent.click(screen.getByRole('button', { name: fill(c.users.enableNamed, { name: 'ada' }) }))
  await waitFor(() => expect(writes()[0]).toEqual({ method: 'PATCH', path: `${userPath(adaId)}/status`, body: { enabled: true } }))
})

test('choosing a role sends one POST, re-reads the user roles and groups, and focuses the select', async () => {
  setup({ [`POST ${userPath(adaId)}/role-assignments`]: created({}) }); open(); await selectUser(); await openTab('roles')
  const before = calls().length
  await choose(c.detail.roles.assign, 'editor')
  await waitFor(() => expect(reads(before).sort()).toEqual([`${userPath(adaId)}/groups`, `${userPath(adaId)}/roles`]))
  expect(writes()).toEqual([{ method: 'POST', path: `${userPath(adaId)}/role-assignments`, body: { roles: ['editor'] } }])
  await waitFor(() => expect(screen.getByRole('combobox', { name: c.detail.roles.assign })).toHaveFocus())
  expect((await screen.findAllByText(fill(c.success.roleAssigned, { name: 'editor' }))).length).toBeGreaterThan(0)
})

test('browsing the select with the keyboard or dismissing it sends nothing', async () => {
  setup(); open(); await selectUser(); await openTab('roles')
  const select = screen.getByRole('combobox', { name: c.detail.roles.assign })
  fireEvent.click(select); await screen.findByRole('option', { name: 'editor' })
  fireEvent.keyDown(select, { key: 'ArrowDown' }); fireEvent.keyDown(select, { key: 'Escape' })
  expect(writes()).toEqual([])
})

test('choosing a group sends one bodyless PUT and re-reads the memberships', async () => {
  setup({ [`PUT ${userPath(adaId)}/groups/synthetic-group-a`]: created({}) }); open(); await selectUser(); await openTab('groups')
  const before = calls().length
  await choose(c.detail.groups.assign, 'group-a')
  await waitFor(() => expect(reads(before)).toHaveLength(2))
  expect(writes()).toEqual([{ method: 'PUT', path: `${userPath(adaId)}/groups/synthetic-group-a`, body: undefined }])
  expect(calls().find(({ method }) => method === 'PUT')).not.toHaveProperty('body', {})
  expect(current().mock.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body).toBeUndefined()
})

test('a failed assignment shows the mutation callout with the mapped message and no reload', async () => {
  setup({ [`POST ${userPath(adaId)}/role-assignments`]: failure(500, { code: 'IAM_ASSIGN_ROLE_FAILED' }) }); open(); await selectUser(); await openTab('roles')
  const before = calls().length
  await choose(c.detail.roles.assign, 'editor')
  expect(await screen.findByText(c.mutationError.title)).toBeVisible()
  expect(screen.getByText(c.errors.codes.IAM_ASSIGN_ROLE_FAILED)).toBeVisible()
  expect(screen.queryByText('synthetic-backend-message')).toBeNull()
  expect(calls().slice(before).filter(({ method }) => method === 'GET')).toEqual([])
})

test('remove role needs confirmation; Cancel sends nothing and returns focus to the opener', async () => {
  setup(); open(); await selectUser(); await openTab('roles')
  const opener = screen.getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }) })
  fireEvent.click(opener)
  const confirm = await dialog()
  expect(within(confirm).getByText(fill(c.confirm.removeRole.description, { role: 'viewer', user: 'ada' }))).toBeVisible()
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toEqual([]); await waitFor(() => expect(opener).toHaveFocus())
})

test('a failed remove role keeps the dialog open with the error and focus inside, without reload or toast', async () => {
  setup({ [`DELETE ${userPath(adaId)}/role-assignments`]: failure(500, { code: 'IAM_REMOVE_ROLE_FAILED' }) }); open(); await selectUser(); await openTab('roles')
  fireEvent.click(screen.getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }) }))
  const confirm = await dialog(), before = calls().length
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.removeRole.action }))
  expect(await within(confirm).findByRole('alert')).toHaveTextContent(c.errors.status['5xx'])
  expect(screen.getByRole('alertdialog')).toBeVisible()
  await waitFor(() => expect(confirm).toContainElement(document.activeElement as HTMLElement))
  expect(calls().slice(before).filter(({ method }) => method === 'GET')).toEqual([])
  expect(screen.queryByText(c.mutationError.title)).toBeNull()
  expect(screen.queryByText(fill(c.success.roleRemoved, { name: 'viewer' }))).toBeNull()
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }) })).toHaveFocus())
})

test('confirming remove role sends DELETE with the role, re-reads the user and focuses the assign select', async () => {
  setup({ [`DELETE ${userPath(adaId)}/role-assignments`]: created({}, 200) }); open(); await selectUser(); await openTab('roles')
  fireEvent.click(screen.getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }) }))
  const confirm = await dialog(), before = calls().length
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.removeRole.action }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toEqual([{ method: 'DELETE', path: `${userPath(adaId)}/role-assignments`, body: { roles: ['viewer'] } }])
  expect(reads(before).sort()).toEqual([`${userPath(adaId)}/groups`, `${userPath(adaId)}/roles`])
  await waitFor(() => expect(screen.getByRole('combobox', { name: c.detail.roles.assign })).toHaveFocus())
})

test('removing a group confirms, sends DELETE and focuses the group select; a failure keeps the dialog', async () => {
  let attempt = 0
  setup({ [`DELETE ${userPath(adaId)}/groups/synthetic-group-support`]: () => { attempt += 1; return attempt === 1 ? failure(500, { code: 'IAM_GROUP_REMOVE_FAILED' })() : Response.json({}) } }); open(); await selectUser(); await openTab('groups')
  fireEvent.click(screen.getByRole('button', { name: fill(c.detail.groups.removeNamed, { name: 'support' }) }))
  const confirm = await dialog()
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.removeGroup.action }))
  expect(await within(confirm).findByRole('alert')).toBeVisible()
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.removeGroup.action }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes().map(({ method, path }) => `${method} ${path}`)).toEqual([`DELETE ${userPath(adaId)}/groups/synthetic-group-support`, `DELETE ${userPath(adaId)}/groups/synthetic-group-support`])
  expect(writes()[1].body).toBeUndefined()
  await waitFor(() => expect(screen.getByRole('combobox', { name: c.detail.groups.assign })).toHaveFocus())
})

test('delete user needs the exact typed username and sends DELETE only then', async () => {
  setup({ [`DELETE ${userPath(adaId)}`]: created({}, 200) }); open(); await table()
  const opener = screen.getByRole('button', { name: fill(c.users.deleteNamed, { name: 'ada' }) })
  fireEvent.click(opener)
  const confirm = await dialog()
  const confirmButton = within(confirm).getByRole('button', { name: c.confirm.deleteUser.action })
  const typed = within(confirm).getByRole('textbox', { name: c.confirm.typedName })
  expect(confirmButton).toBeDisabled()
  fireEvent.change(typed, { target: { value: 'ad' } }); expect(confirmButton).toBeDisabled()
  fireEvent.change(typed, { target: { value: 'Ada' } }); expect(confirmButton).toBeDisabled()
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes()).toEqual([])
  await waitFor(() => expect(opener).toHaveFocus())
  fireEvent.click(opener)
  const again = await dialog(), before = calls().length
  fireEvent.change(within(again).getByRole('textbox', { name: c.confirm.typedName }), { target: { value: 'ada' } })
  fireEvent.click(within(again).getByRole('button', { name: c.confirm.deleteUser.action }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toEqual([{ method: 'DELETE', path: userPath(adaId), body: undefined }])
  expect(reads(before).sort()).toEqual([firstUsers, groupsPath, rolesPath].sort())
  await waitFor(() => expect(search()).toHaveFocus())
  expect((await screen.findAllByText(c.success.deleted)).length).toBeGreaterThan(0)
})

test('a failed delete keeps the dialog open with the error and focus inside, without reload', async () => {
  setup({ [`DELETE ${userPath(adaId)}`]: failure(500, { code: 'DELETE_USER_FAILED' }) }); open(); await selectUser()
  fireEvent.click(screen.getByRole('button', { name: c.detail.delete }))
  const confirm = await dialog(), before = calls().length
  fireEvent.change(within(confirm).getByRole('textbox', { name: c.confirm.typedName }), { target: { value: 'ada' } })
  fireEvent.click(within(confirm).getByRole('button', { name: c.confirm.deleteUser.action }))
  expect(await within(confirm).findByRole('alert')).toHaveTextContent(c.errors.status['5xx'])
  await waitFor(() => expect(confirm).toContainElement(document.activeElement as HTMLElement))
  expect(within(confirm).getByRole('textbox', { name: c.confirm.typedName })).toHaveValue('ada')
  expect(calls().slice(before).filter(({ method }) => method === 'GET')).toEqual([])
  expect(screen.queryByText(c.mutationError.title)).toBeNull(); expect(screen.queryByText(c.success.deleted)).toBeNull()
})

test('legacy default-role helpers and adjacent fixtures stay consistent', () => {
  expect(adaRoles.map((role) => role.roleName)).toContain('default-roles-synthetic-tenant'); expect(adaGroups).toHaveLength(1)
})
