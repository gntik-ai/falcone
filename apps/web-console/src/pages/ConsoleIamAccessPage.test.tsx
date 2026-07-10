import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleIamAccessPage } from './ConsoleIamAccessPage'

import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn()
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: vi.fn()
}))

const useConsoleContextMock = vi.mocked(useConsoleContext)
const requestConsoleSessionJsonMock = vi.mocked(requestConsoleSessionJson)

const rawKeycloakMessage = 'keycloak POST /realms/tenant-alpha/users/usr-1/role-mappings/realm -> 404: {"error":"verbatim upstream body"}'
const rawRealmUrlMessage = 'https://sso.example.test/realms/tenant-alpha/protocol/openid-connect/token -> 502: {"errorMessage":"verbatim upstream body"}'

interface IamUserFixture {
  id: string
  userId: string
  username: string
  email: string | null
  enabled: boolean
  state: 'active' | 'suspended'
}

interface IamRoleFixture {
  id: string
  name: string
  roleName: string
  description: string | null
}

interface IamGroupFixture {
  id: string
  name: string
  path: string
}

interface IamApiState {
  users: IamUserFixture[]
  roles: IamRoleFixture[]
  groups: IamGroupFixture[]
  userRoles: Record<string, string[]>
  userGroups: Record<string, string[]>
  mutationError?: unknown
  loadErrorOnce?: boolean
  detailDelayUsers?: Record<string, Promise<void>>
  detailErrorUsers?: Record<string, unknown>
}

describe('ConsoleIamAccessPage', () => {
  beforeEach(() => {
    useConsoleContextMock.mockReturnValue({
      activeTenantId: 'tenant-alpha',
      activeTenant: {
        tenantId: 'tenant-alpha',
        label: 'Tenant Alpha',
        secondary: 'alpha',
        state: 'active',
        governanceStatus: null,
        consoleUserRealm: 'tenant-alpha',
        provisioningStatus: 'ready',
        quotaSummary: null,
        inventorySummary: null
      },
    } as never)

    stubIamApi()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('lets a superadmin create, suspend, enable, and delete a realm user through the existing IAM routes', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [createRole('tenant_admin')],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] }
    })

    render(<ConsoleIamAccessPage />)

    await user.type(await screen.findByLabelText(/^usuario$/i), 'grace')
    await user.type(screen.getByLabelText(/email/i), 'grace@example.test')
    await user.type(screen.getByLabelText(/contraseña temporal/i), 'TempPassw0rd!')
    await user.selectOptions(screen.getByLabelText(/rol inicial/i), 'tenant_admin')
    await user.click(screen.getByRole('button', { name: /^crear usuario$/i }))

    expect(await screen.findByTestId('iam-access-success')).toHaveTextContent(/usuario iam creado/i)
    expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
      '/v1/iam/realms/tenant-alpha/users',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          username: 'grace',
          email: 'grace@example.test',
          bootstrapCredentials: { temporaryPassword: 'TempPassw0rd!' },
          realmRoles: ['tenant_admin'],
          enabled: true,
          emailVerified: true
        })
      })
    )
    expect(await screen.findByRole('button', { name: /grace/i })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.click(screen.getAllByRole('button', { name: /^suspender$/i })[0])
    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/users/usr-1/status',
        expect.objectContaining({ method: 'PATCH', body: { enabled: false } })
      )
    })

    await user.click(screen.getAllByRole('button', { name: /^habilitar$/i })[0])
    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/users/usr-1/status',
        expect.objectContaining({ method: 'PATCH', body: { enabled: true } })
      )
    })

    await user.click(screen.getAllByRole('button', { name: /^eliminar$/i })[0])
    const deleteDialog = screen.getByRole('alertdialog')
    expect(deleteDialog).toBeInTheDocument()
    await user.type(within(deleteDialog).getByPlaceholderText('ada'), 'ada')
    await user.click(within(deleteDialog).getByRole('button', { name: /^eliminar$/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/users/usr-1',
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  it('requires a username before submitting the create-user payload', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [createRole('tenant_admin')],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] }
    })

    render(<ConsoleIamAccessPage />)

    await screen.findByLabelText(/^usuario$/i)
    const createButton = screen.getByRole('button', { name: /^crear usuario$/i })

    expect(createButton).toBeDisabled()
    await user.type(screen.getByLabelText(/email/i), 'email-only@example.test')
    expect(createButton).toBeDisabled()
    expect(findMutationCall('POST', '/v1/iam/realms/tenant-alpha/users')).toBeUndefined()

    await user.type(screen.getByLabelText(/^usuario$/i), 'grace')
    expect(createButton).toBeEnabled()
  })

  it('creates roles and groups, refreshes the catalog, and exposes them as assignable options', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] }
    })

    render(<ConsoleIamAccessPage />)

    await user.type(await screen.findByLabelText(/nombre del rol/i), 'security_auditor')
    await user.click(screen.getByRole('button', { name: /^crear rol$/i }))
    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/roles',
        expect.objectContaining({ method: 'POST', body: { roleName: 'security_auditor' } })
      )
    })

    await user.type(screen.getByLabelText(/nombre del grupo/i), 'soporte')
    await user.click(screen.getByRole('button', { name: /^crear grupo$/i }))
    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/groups',
        expect.objectContaining({ method: 'POST', body: { name: 'soporte' } })
      )
    })

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.selectOptions(await screen.findByLabelText(/rol a asignar/i), 'security_auditor')
    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/users/usr-1/role-assignments',
        expect.objectContaining({ method: 'POST', body: { roles: ['security_auditor'] } })
      )
    })

    await user.selectOptions(await screen.findByLabelText(/grupo a asignar/i), 'grp-soporte')
    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/users/usr-1/groups/grp-soporte',
        expect.objectContaining({ method: 'PUT' })
      )
    })
    const groupAddOptions = findMutationCall('PUT', '/groups/grp-soporte')?.[1] as { body?: JsonValue } | undefined
    expect(groupAddOptions).not.toHaveProperty('body')
  })

  it('uses the IAM state field for stale suspended users in the detail controls', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada', { enabled: true, state: 'suspended' })],
      roles: [],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] }
    })

    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.click(await screen.findByRole('button', { name: /^habilitar usuario$/i }))

    await waitFor(() => {
      expect(requestConsoleSessionJsonMock).toHaveBeenCalledWith(
        '/v1/iam/realms/tenant-alpha/users/usr-1/status',
        expect.objectContaining({ method: 'PATCH', body: { enabled: true } })
      )
    })
  })

  it('requires confirmation before removing role and group memberships', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [createRole('tenant_admin')],
      groups: [createGroup('grp-1', 'soporte')],
      userRoles: { 'usr-1': ['tenant_admin'] },
      userGroups: { 'usr-1': ['grp-1'] }
    })

    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await screen.findByRole('button', { name: /quitar rol tenant_admin/i })

    await user.click(screen.getByRole('button', { name: /quitar rol tenant_admin/i }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(findMutationCall('DELETE', '/role-assignments')).toBeUndefined()
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() => {
      expect(findMutationCall('DELETE', '/role-assignments')).toBeDefined()
    })
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByLabelText(/rol a asignar/i)).toHaveFocus()
    })

    await user.click(await screen.findByRole('button', { name: /quitar de grupo soporte/i }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(findMutationCall('DELETE', '/groups/grp-1')).toBeUndefined()
    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))
    await waitFor(() => {
      expect(findMutationCall('DELETE', '/groups/grp-1')).toBeDefined()
    })
    const groupRemoveOptions = findMutationCall('DELETE', '/groups/grp-1')?.[1] as { body?: JsonValue } | undefined
    expect(groupRemoveOptions).not.toHaveProperty('body')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByLabelText(/grupo a asignar/i)).toHaveFocus()
    })
  })

  it('clears stale membership controls when selected-user detail loading fails', async () => {
    const user = userEvent.setup()
    let releaseGraceDetail: (() => void) | undefined
    const graceDetailPending = new Promise<void>((resolve) => {
      releaseGraceDetail = resolve
    })
    const detailErrorUsers: Record<string, unknown> = {
      'usr-2': { status: 503, code: 'IAM_LIST_USER_ROLES_FAILED', message: 'detail backend unavailable' }
    }
    stubIamApi({
      users: [createUser('usr-1', 'ada'), createUser('usr-2', 'grace')],
      roles: [createRole('tenant_admin')],
      groups: [createGroup('grp-1', 'soporte')],
      userRoles: { 'usr-1': ['tenant_admin'], 'usr-2': [] },
      userGroups: { 'usr-1': ['grp-1'], 'usr-2': [] },
      detailDelayUsers: { 'usr-2': graceDetailPending },
      detailErrorUsers
    })

    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    expect(await screen.findByRole('button', { name: /quitar rol tenant_admin/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /quitar de grupo soporte/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /grace/i }))

    expect(await screen.findByText(/cargando detalle/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quitar rol tenant_admin/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quitar de grupo soporte/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/rol a asignar/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/grupo a asignar/i)).not.toBeInTheDocument()
    releaseGraceDetail?.()

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar el detalle del usuario iam/i)
    expect(screen.queryByRole('button', { name: /quitar rol tenant_admin/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /quitar de grupo soporte/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/rol a asignar/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/grupo a asignar/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^sin roles\.$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^sin grupos\.$/i)).not.toBeInTheDocument()
    expect(findMutationCall('POST', '/users/usr-2/role-assignments')).toBeUndefined()
    expect(findMutationCall('PUT', '/users/usr-2/groups/grp-1')).toBeUndefined()
    expect(findMutationCall('DELETE', '/users/usr-2/role-assignments')).toBeUndefined()
    expect(findMutationCall('DELETE', '/users/usr-2/groups/grp-1')).toBeUndefined()

    delete detailErrorUsers['usr-2']
    await user.click(screen.getByRole('button', { name: /reintentar detalle/i }))

    expect(await screen.findByText(/^sin roles\.$/i)).toBeInTheDocument()
    expect(await screen.findByText(/^sin grupos\.$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/rol a asignar/i)).toBeEnabled()
    expect(screen.getByLabelText(/grupo a asignar/i)).toBeEnabled()
  })

  it('searches and paginates users and renders empty search state with ConsolePageState affordances', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: Array.from({ length: 12 }, (_, index) => createUser(`usr-${index + 1}`, `user-${String(index + 1).padStart(2, '0')}`)),
      roles: [],
      groups: [],
      userRoles: {},
      userGroups: {}
    })

    render(<ConsoleIamAccessPage />)

    expect(await screen.findByRole('button', { name: /user-01/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /user-12/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(await screen.findByRole('button', { name: /user-12/i })).toBeInTheDocument()

    await user.clear(screen.getByLabelText(/buscar usuarios/i))
    await user.type(screen.getByLabelText(/buscar usuarios/i), 'user-03')
    expect(await screen.findByRole('button', { name: /user-03/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /user-12/i })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText(/buscar usuarios/i))
    await user.type(screen.getByLabelText(/buscar usuarios/i), 'missing-user')
    expect(await screen.findByText(/sin resultados/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /limpiar búsqueda/i }))
    expect(screen.getByLabelText(/buscar usuarios/i)).toHaveValue('')
    await waitFor(() => {
      expect(screen.getByLabelText(/buscar usuarios/i)).toHaveFocus()
    })
  })

  it('uses ConsolePageState for load failures and retries the catalog request', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [],
      groups: [],
      userRoles: {},
      userGroups: {},
      loadErrorOnce: true
    })

    render(<ConsoleIamAccessPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo cargar el inventario iam/i)
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(await screen.findByRole('button', { name: /ada/i })).toBeInTheDocument()
  })

  it('announces successful mutations and restores keyboard focus after a refetch', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [createRole('tenant_admin'), createRole('tenant_viewer')],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] }
    })

    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    const assignRole = await screen.findByLabelText(/rol a asignar/i)
    assignRole.focus()
    await user.selectOptions(assignRole, 'tenant_admin')

    expect(await screen.findByTestId('iam-access-success')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('iam-access-success')).toHaveTextContent(/rol tenant_admin asignado/i)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/rol a asignar/i))
    })
  })

  it('renders a friendly localized IAM mutation alert without raw Keycloak details', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [createRole('tenant_admin')],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] },
      mutationError: {
        status: 404,
        code: 'IAM_ASSIGN_ROLE_FAILED',
        message: rawKeycloakMessage
      }
    })

    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.selectOptions(await screen.findByLabelText(/rol a asignar/i), 'tenant_admin')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo actualizar el acceso iam/i)
    expect(alert).not.toHaveTextContent(/keycloak\s/i)
    expect(alert).not.toHaveTextContent(/\/realms\//i)
    expect(alert).not.toHaveTextContent(/verbatim upstream body/i)
  })

  it('uses shared localized error mapping for unmapped forbidden backend messages', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [createRole('tenant_admin')],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] },
      mutationError: {
        status: 403,
        code: 'FORBIDDEN',
        message: 'requires superadmin'
      }
    })

    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.selectOptions(await screen.findByLabelText(/rol a asignar/i), 'tenant_admin')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no tienes permiso para ver este recurso/i)
    expect(alert).not.toHaveTextContent(/requires superadmin/i)
  })

  it('uses shared status mapping when an unknown IAM mutation error includes realm URL fragments', async () => {
    const user = userEvent.setup()
    stubIamApi({
      users: [createUser('usr-1', 'ada')],
      roles: [createRole('tenant_admin')],
      groups: [],
      userRoles: { 'usr-1': [] },
      userGroups: { 'usr-1': [] },
      mutationError: {
        status: 502,
        code: 'HTTP_502',
        message: rawRealmUrlMessage
      }
    })

    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.selectOptions(await screen.findByLabelText(/rol a asignar/i), 'tenant_admin')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/el servicio no está disponible/i)
    expect(alert).not.toHaveTextContent(/\/realms\//i)
    expect(alert).not.toHaveTextContent(/sso\.example\.test/i)
    expect(alert).not.toHaveTextContent(/verbatim upstream body/i)
  })
})

function stubIamApi(overrides: Partial<IamApiState> = {}) {
  const state: IamApiState = {
    users: [createUser('usr-1', 'ada')],
    roles: [createRole('tenant_admin')],
    groups: [createGroup('grp-1', 'soporte')],
    userRoles: { 'usr-1': [] },
    userGroups: { 'usr-1': [] },
    ...overrides
  }

  requestConsoleSessionJsonMock.mockImplementation(async (url: string, options?: { method?: string; body?: JsonValue }) => {
    const method = options?.method ?? 'GET'

    if (state.loadErrorOnce && method === 'GET' && url.startsWith('/v1/iam/realms/tenant-alpha/users?')) {
      state.loadErrorOnce = false
      throw { status: 503, code: 'IAM_LIST_USERS_FAILED', message: 'backend unavailable' }
    }

    const detailMatch = url.match(/^\/v1\/iam\/realms\/tenant-alpha\/users\/([^/]+)\/(roles|groups)$/)
    if (method === 'GET' && detailMatch?.[2] === 'roles') {
      const userId = decodeURIComponent(detailMatch[1])
      await state.detailDelayUsers?.[userId]
      if (state.detailErrorUsers?.[userId]) throw state.detailErrorUsers[userId]
      return collection((state.userRoles[userId] ?? []).map((roleName) => createRole(roleName)))
    }
    if (method === 'GET' && detailMatch?.[2] === 'groups') {
      const userId = decodeURIComponent(detailMatch[1])
      await state.detailDelayUsers?.[userId]
      if (state.detailErrorUsers?.[userId]) throw state.detailErrorUsers[userId]
      const assignedGroupIds = state.userGroups[userId] ?? []
      return collection(state.groups.filter((group) => assignedGroupIds.includes(group.id)))
    }

    if (method === 'GET' && url.startsWith('/v1/iam/realms/tenant-alpha/users?')) return collection(state.users)
    if (method === 'GET' && url === '/v1/iam/realms/tenant-alpha/roles') return collection(state.roles)
    if (method === 'GET' && url === '/v1/iam/realms/tenant-alpha/groups') return collection(state.groups)

    if (method === 'POST' && url === '/v1/iam/realms/tenant-alpha/users') {
      const body = objectBody(options?.body)
      const username = String(body.username ?? body.email ?? 'new-user')
      const userId = `usr-${username}`
      state.users.push(createUser(userId, username, { email: typeof body.email === 'string' ? body.email : null }))
      state.userRoles[userId] = Array.isArray(body.realmRoles) ? body.realmRoles.filter((role): role is string => typeof role === 'string') : []
      state.userGroups[userId] = []
      return { userId, username }
    }

    if (method === 'PATCH' && url.endsWith('/status')) {
      const userId = decodeURIComponent(url.match(/\/users\/([^/]+)\/status$/)?.[1] ?? '')
      const body = objectBody(options?.body)
      const enabled = body.enabled === true
      state.users = state.users.map((entry) => entry.userId === userId ? { ...entry, enabled, state: enabled ? 'active' : 'suspended' } : entry)
      return { userId, enabled, state: enabled ? 'active' : 'suspended' }
    }

    if (method === 'DELETE' && /^\/v1\/iam\/realms\/tenant-alpha\/users\/[^/]+$/.test(url)) {
      const userId = decodeURIComponent(url.match(/\/users\/([^/]+)$/)?.[1] ?? '')
      state.users = state.users.filter((entry) => entry.userId !== userId)
      delete state.userRoles[userId]
      delete state.userGroups[userId]
      return { userId, deleted: true }
    }

    if (method === 'POST' && url === '/v1/iam/realms/tenant-alpha/roles') {
      const name = String(objectBody(options?.body).roleName ?? '')
      state.roles.push(createRole(name))
      return { roleName: name }
    }

    if (method === 'POST' && url === '/v1/iam/realms/tenant-alpha/groups') {
      const name = String(objectBody(options?.body).name ?? '')
      const group = createGroup(`grp-${name}`, name)
      state.groups.push(group)
      return group
    }

    if (url.endsWith('/role-assignments')) {
      if (state.mutationError) throw state.mutationError
      const userId = decodeURIComponent(url.match(/\/users\/([^/]+)\/role-assignments$/)?.[1] ?? '')
      const requestBody = objectBody(options?.body)
      const maybeRoles = requestBody.roles
      const roles = Array.isArray(maybeRoles)
        ? maybeRoles.filter((role): role is string => typeof role === 'string')
        : []
      if (method === 'POST') {
        state.userRoles[userId] = [...new Set([...(state.userRoles[userId] ?? []), ...roles])]
        return { assigned: roles }
      }
      if (method === 'DELETE') {
        state.userRoles[userId] = (state.userRoles[userId] ?? []).filter((role) => !roles.includes(role))
        return { removed: roles }
      }
    }

    const groupMembershipMatch = url.match(/^\/v1\/iam\/realms\/tenant-alpha\/users\/([^/]+)\/groups\/([^/]+)$/)
    if (groupMembershipMatch) {
      if (state.mutationError) throw state.mutationError
      const userId = decodeURIComponent(groupMembershipMatch[1])
      const groupId = decodeURIComponent(groupMembershipMatch[2])
      if (method === 'PUT') {
        state.userGroups[userId] = [...new Set([...(state.userGroups[userId] ?? []), groupId])]
        return { member: true }
      }
      if (method === 'DELETE') {
        state.userGroups[userId] = (state.userGroups[userId] ?? []).filter((id) => id !== groupId)
        return { member: false }
      }
    }

    throw new Error(`unexpected request ${method} ${url}`)
  })
}

function createUser(userId: string, username: string, overrides: Partial<IamUserFixture> = {}): IamUserFixture {
  return {
    id: userId,
    userId,
    username,
    email: `${username}@example.test`,
    enabled: true,
    state: 'active',
    ...overrides
  }
}

function createRole(name: string): IamRoleFixture {
  return {
    id: `role-${name}`,
    name,
    roleName: name,
    description: null
  }
}

function createGroup(id: string, name: string): IamGroupFixture {
  return {
    id,
    name,
    path: `/${name}`
  }
}

function collection<T>(items: T[]) {
  return { items, total: items.length, page: { after: null, size: items.length } }
}

function objectBody(body: JsonValue | undefined): Record<string, JsonValue> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
}

function findMutationCall(method: string, pathFragment: string) {
  return requestConsoleSessionJsonMock.mock.calls.find(([url, options]) => {
    const requestOptions = options as { method?: string } | undefined
    return typeof url === 'string' && url.includes(pathFragment) && requestOptions?.method === method
  })
}
