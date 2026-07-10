import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, Plus, RefreshCw, Search, Trash2, UserCheck, UserMinus, X } from 'lucide-react'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { ApiError, JsonValue } from '@/lib/http'

interface IamUser {
  id?: string
  userId?: string
  username: string
  email: string | null
  enabled: boolean
  state?: 'active' | 'suspended' | 'disabled' | string | null
}
interface IamRole {
  id?: string
  name?: string
  roleName?: string
  description?: string | null
}
interface IamGroup {
  id: string
  name: string
  path?: string | null
}
interface ListUsersResponse {
  items: IamUser[]
  total: number
}
interface ListRolesResponse {
  items: IamRole[]
  total: number
}
interface ListGroupsResponse {
  items: IamGroup[]
  total: number
}
interface CreateUserResponse {
  id?: string
  userId?: string
}

const USERS_PAGE_SIZE = 10

const IAM_ACCESS_ERROR_MESSAGES: Record<string, string> = {
  IAM_ASSIGN_ROLE_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_REMOVE_ROLE_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_GROUP_ADD_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_GROUP_REMOVE_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_CREATE_USER_FAILED: 'No se pudo crear el usuario IAM. Revisa los datos e inténtalo de nuevo.',
  SET_USER_STATUS_FAILED: 'No se pudo actualizar el estado del usuario IAM. Inténtalo de nuevo.',
  DELETE_USER_FAILED: 'No se pudo eliminar el usuario IAM. Inténtalo de nuevo.',
  IAM_CREATE_ROLE_FAILED: 'No se pudo crear el rol IAM. Revisa el nombre e inténtalo de nuevo.',
  IAM_CREATE_GROUP_FAILED: 'No se pudo crear el grupo IAM. Revisa el nombre e inténtalo de nuevo.',
  IAM_LIST_USERS_FAILED: 'No se pudo cargar el inventario IAM de la organización activa.',
  IAM_LIST_ROLES_FAILED: 'No se pudo cargar el inventario IAM de la organización activa.',
  IAM_LIST_GROUPS_FAILED: 'No se pudo cargar el inventario IAM de la organización activa.',
  IAM_LIST_CLIENTS_FAILED: 'No se pudo cargar el inventario IAM de la organización activa.',
  IAM_GET_USER_FAILED: 'No se pudo cargar el detalle del usuario IAM.',
  IAM_GET_ROLE_FAILED: 'No se pudo cargar la información de roles IAM.',
  IAM_LIST_USER_ROLES_FAILED: 'No se pudo cargar el detalle del usuario IAM.',
  IAM_LIST_USER_GROUPS_FAILED: 'No se pudo cargar el detalle del usuario IAM.',
  IAM_LIST_GROUP_MEMBERS_FAILED: 'No se pudo cargar la información del grupo IAM.',
  UNSUPPORTED_FIELD: 'La operación pidió campos IAM que este entorno todavía no puede aplicar.'
}

const RAW_KEYCLOAK_ERROR_PATTERN = /\bkeycloak\s+[A-Z]+\s+\/realms\/|\/admin\/realms\/|\/realms\/|\{[^{}]*(?:"error"|"errorMessage")\s*:/i

function errMsg(error: unknown, fallback: string): string {
  const apiError = error as Partial<ApiError>
  const code = apiError?.code?.trim()
  if (code && IAM_ACCESS_ERROR_MESSAGES[code]) return IAM_ACCESS_ERROR_MESSAGES[code]

  const message = apiError?.message?.trim()
  if (!message || RAW_KEYCLOAK_ERROR_PATTERN.test(message)) return fallback
  return message
}

function getUserId(user: IamUser): string {
  return user.userId ?? user.id ?? user.username
}

function getRoleName(role: IamRole): string {
  return role.roleName ?? role.name ?? ''
}

function normalizeForSearch(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function isUserSuspended(user: IamUser): boolean {
  return user.enabled === false || user.state === 'suspended' || user.state === 'disabled'
}

export function ConsoleIamAccessPage() {
  const { activeTenant, activeTenantId } = useConsoleContext()
  // Falcone tenancy model: the realm name == the tenantId.
  const realm = activeTenantId
  const destructiveOp = useDestructiveOp()

  const [users, setUsers] = useState<IamUser[]>([])
  const [roles, setRoles] = useState<IamRole[]>([])
  const [groups, setGroups] = useState<IamGroup[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [userRoles, setUserRoles] = useState<IamRole[]>([])
  const [userGroups, setUserGroups] = useState<IamGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(0)
  const [createUserForm, setCreateUserForm] = useState({ username: '', email: '', password: '', role: '' })
  const [createRoleForm, setCreateRoleForm] = useState({ name: '' })
  const [createGroupForm, setCreateGroupForm] = useState({ name: '' })

  const restoreFocus = useCallback((focusKey?: string | null) => {
    if (!focusKey) return
    window.setTimeout(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-key]'))
        .find((element) => element.dataset.focusKey === focusKey)
      target?.focus()
    }, 0)
  }, [])

  const loadCatalog = useCallback(async (
    realmId: string,
    options: {
      preserveSelection?: boolean
      preferredUserId?: string | null
      focusKey?: string
      successMessage?: string
    } = {}
  ) => {
    setLoading(true)
    setLoadError(null)
    setMutationError(null)
    if (!options.preserveSelection) {
      setSelectedUserId(null)
      setUserRoles([])
      setUserGroups([])
    }

    try {
      const base = `/v1/iam/realms/${encodeURIComponent(realmId)}`
      const [usersRes, rolesRes, groupsRes] = await Promise.all([
        requestConsoleSessionJson<ListUsersResponse>(`${base}/users?page%5Bsize%5D=200`),
        requestConsoleSessionJson<ListRolesResponse>(`${base}/roles`),
        requestConsoleSessionJson<ListGroupsResponse>(`${base}/groups`)
      ])
      const nextUsers = usersRes.items ?? []
      setUsers(nextUsers)
      setUserTotal(usersRes.total ?? nextUsers.length)
      setRoles(rolesRes.items ?? [])
      setGroups(groupsRes.items ?? [])
      setSelectedUserId((currentUserId) => {
        const preferredUserId = options.preferredUserId
        if (preferredUserId && nextUsers.some((user) => getUserId(user) === preferredUserId)) {
          return preferredUserId
        }
        if (options.preserveSelection && currentUserId && nextUsers.some((user) => getUserId(user) === currentUserId)) {
          return currentUserId
        }
        return null
      })
      if (options.successMessage) {
        setSuccessMessage(options.successMessage)
      }
      restoreFocus(options.focusKey)
    } catch (rawError) {
      setLoadError(errMsg(rawError, 'No se pudo cargar el IAM de la organización activa.'))
    } finally {
      setLoading(false)
    }
  }, [restoreFocus])

  const loadUserDetail = useCallback(async (
    realmId: string,
    userId: string,
    options: { focusKey?: string; successMessage?: string } = {}
  ) => {
    setDetailLoading(true)
    setMutationError(null)
    try {
      const base = `/v1/iam/realms/${encodeURIComponent(realmId)}/users/${encodeURIComponent(userId)}`
      const [rolesRes, groupsRes] = await Promise.all([
        requestConsoleSessionJson<ListRolesResponse>(`${base}/roles`),
        requestConsoleSessionJson<ListGroupsResponse>(`${base}/groups`)
      ])
      setUserRoles(rolesRes.items ?? [])
      setUserGroups(groupsRes.items ?? [])
      if (options.successMessage) {
        setSuccessMessage(options.successMessage)
      }
      restoreFocus(options.focusKey)
    } catch (rawError) {
      setMutationError(errMsg(rawError, 'No se pudo cargar el detalle del usuario.'))
    } finally {
      setDetailLoading(false)
    }
  }, [restoreFocus])

  useEffect(() => {
    if (!realm) {
      setUsers([])
      setRoles([])
      setGroups([])
      setUserTotal(0)
      setSelectedUserId(null)
      setUserRoles([])
      setUserGroups([])
      setLoadError(null)
      return
    }
    void loadCatalog(realm)
  }, [realm, loadCatalog])

  useEffect(() => {
    if (!realm || !selectedUserId) {
      setUserRoles([])
      setUserGroups([])
      return
    }
    void loadUserDetail(realm, selectedUserId)
  }, [realm, selectedUserId, loadUserDetail])

  useEffect(() => {
    setUserPage(0)
  }, [userSearch, users.length])

  const filteredUsers = useMemo(() => {
    const query = normalizeForSearch(userSearch)
    if (!query) return users
    return users.filter((user) => {
      const id = getUserId(user)
      return (
        normalizeForSearch(user.username).includes(query) ||
        normalizeForSearch(user.email).includes(query) ||
        normalizeForSearch(id).includes(query)
      )
    })
  }, [userSearch, users])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE))
  const currentPage = Math.min(userPage, totalPages - 1)
  const pagedUsers = filteredUsers.slice(currentPage * USERS_PAGE_SIZE, currentPage * USERS_PAGE_SIZE + USERS_PAGE_SIZE)
  const selectedUser = users.find((user) => getUserId(user) === selectedUserId) ?? null
  const assignedRoleNames = new Set(userRoles.map((role) => getRoleName(role)).filter(Boolean))
  const assignedGroupIds = new Set(userGroups.map((group) => group.id))
  const assignableRoles = roles.filter((role) => {
    const roleName = getRoleName(role)
    return roleName && !assignedRoleNames.has(roleName) && !roleName.startsWith('default-roles')
  })
  const assignableGroups = groups.filter((group) => !assignedGroupIds.has(group.id))
  const normalizedRoleOptions = roles
    .map((role) => getRoleName(role))
    .filter((roleName) => roleName && !roleName.startsWith('default-roles'))

  function beginMutation() {
    setBusy(true)
    setMutationError(null)
    setSuccessMessage(null)
  }

  function finishMutation() {
    setBusy(false)
  }

  function clearUserSearch() {
    setUserSearch('')
    restoreFocus('users-search')
  }

  async function createUser(event: FormEvent) {
    event.preventDefault()
    if (!realm) return
    const username = createUserForm.username.trim()
    const email = createUserForm.email.trim()
    const password = createUserForm.password.trim()
    const role = createUserForm.role.trim()
    if (!username) return

    const body: { [key: string]: JsonValue } = {
      enabled: true,
      emailVerified: true
    }
    if (username) body.username = username
    if (email) body.email = email
    if (password) body.bootstrapCredentials = { temporaryPassword: password }
    if (role) body.realmRoles = [role]

    beginMutation()
    try {
      const response = await requestConsoleSessionJson<CreateUserResponse>(`/v1/iam/realms/${encodeURIComponent(realm)}/users`, {
        method: 'POST',
        body
      })
      const createdUserId = response.userId ?? response.id ?? null
      setCreateUserForm({ username: '', email: '', password: '', role: '' })
      await loadCatalog(realm, {
        preserveSelection: false,
        preferredUserId: createdUserId,
        focusKey: createdUserId ? `user-row-${createdUserId}` : 'create-user-username',
        successMessage: 'Usuario IAM creado.'
      })
    } catch (rawError) {
      setMutationError(errMsg(rawError, 'No se pudo crear el usuario IAM.'))
      restoreFocus('create-user-username')
    } finally {
      finishMutation()
    }
  }

  async function createRole(event: FormEvent) {
    event.preventDefault()
    if (!realm) return
    const roleName = createRoleForm.name.trim()
    if (!roleName) return

    beginMutation()
    try {
      await requestConsoleSessionJson(`/v1/iam/realms/${encodeURIComponent(realm)}/roles`, {
        method: 'POST',
        body: { name: roleName }
      })
      setCreateRoleForm({ name: '' })
      await loadCatalog(realm, {
        preserveSelection: true,
        focusKey: 'create-role-name',
        successMessage: `Rol ${roleName} creado.`
      })
    } catch (rawError) {
      setMutationError(errMsg(rawError, 'No se pudo crear el rol IAM.'))
      restoreFocus('create-role-name')
    } finally {
      finishMutation()
    }
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault()
    if (!realm) return
    const groupName = createGroupForm.name.trim()
    if (!groupName) return

    beginMutation()
    try {
      await requestConsoleSessionJson(`/v1/iam/realms/${encodeURIComponent(realm)}/groups`, {
        method: 'POST',
        body: { name: groupName }
      })
      setCreateGroupForm({ name: '' })
      await loadCatalog(realm, {
        preserveSelection: true,
        focusKey: 'create-group-name',
        successMessage: `Grupo ${groupName} creado.`
      })
    } catch (rawError) {
      setMutationError(errMsg(rawError, 'No se pudo crear el grupo IAM.'))
      restoreFocus('create-group-name')
    } finally {
      finishMutation()
    }
  }

  async function mutateMembership(
    path: string,
    method: 'POST' | 'DELETE' | 'PUT',
    body: JsonValue | undefined,
    focusKey: string,
    success: string,
    options: { rethrow?: boolean } = {}
  ) {
    if (!realm || !selectedUserId) return
    beginMutation()
    try {
      await requestConsoleSessionJson(path, { method, body: body ?? ({} as JsonValue) })
      await loadUserDetail(realm, selectedUserId, { focusKey, successMessage: success })
    } catch (rawError) {
      setMutationError(errMsg(rawError, 'La operación de IAM no pudo completarse.'))
      if (!options.rethrow) {
        restoreFocus(focusKey)
      }
      if (options.rethrow) {
        throw rawError
      }
    } finally {
      finishMutation()
    }
  }

  async function setUserStatus(user: IamUser, enabled: boolean, focusKey?: string) {
    if (!realm) return
    const userId = getUserId(user)
    const restoreFocusKey = focusKey ?? `status-user-${userId}`
    beginMutation()
    try {
      await requestConsoleSessionJson(`/v1/iam/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        body: { enabled }
      })
      await loadCatalog(realm, {
        preserveSelection: true,
        focusKey: restoreFocusKey,
        successMessage: enabled ? 'Usuario IAM habilitado.' : 'Usuario IAM suspendido.'
      })
    } catch (rawError) {
      setMutationError(errMsg(rawError, 'No se pudo actualizar el estado del usuario IAM.'))
      restoreFocus(restoreFocusKey)
    } finally {
      finishMutation()
    }
  }

  function confirmDeleteUser(user: IamUser) {
    if (!realm) return
    const userId = getUserId(user)
    destructiveOp.openDialog({
      level: 'CRITICAL',
      operationId: `delete-iam-user-${userId}`,
      resourceId: userId,
      resourceName: user.username,
      resourceType: 'usuario IAM',
      cascadeImpact: [],
      impactDescription: 'Se eliminará el usuario del realm activo y se retirarán sus roles y pertenencias a grupos.',
      onSuccess: () => restoreFocus('users-search'),
      onConfirm: async () => {
        beginMutation()
        try {
          await requestConsoleSessionJson(`/v1/iam/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE'
          })
          await loadCatalog(realm, {
            preserveSelection: false,
            focusKey: 'users-search',
            successMessage: 'Usuario IAM eliminado.'
          })
        } catch (rawError) {
          setMutationError(errMsg(rawError, 'No se pudo eliminar el usuario IAM.'))
          throw rawError
        } finally {
          finishMutation()
        }
      }
    })
  }

  function confirmRemoveRole(role: IamRole) {
    if (!realm || !selectedUserId) return
    const roleName = getRoleName(role)
    const base = `/v1/iam/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(selectedUserId)}`
    destructiveOp.openDialog({
      level: 'WARNING',
      operationId: `remove-iam-role-${selectedUserId}-${roleName}`,
      resourceName: roleName,
      resourceType: 'rol asignado',
      impactDescription: `Se retirará el rol ${roleName} de ${selectedUser?.username ?? 'este usuario'}.`,
      onSuccess: () => restoreFocus('assign-role'),
      onConfirm: () => mutateMembership(
        `${base}/role-assignments`,
        'DELETE',
        { roles: [roleName] },
        `remove-role-${roleName}`,
        `Rol ${roleName} retirado.`,
        { rethrow: true }
      )
    })
  }

  function confirmRemoveGroup(group: IamGroup) {
    if (!realm || !selectedUserId) return
    const base = `/v1/iam/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(selectedUserId)}`
    destructiveOp.openDialog({
      level: 'WARNING',
      operationId: `remove-iam-group-${selectedUserId}-${group.id}`,
      resourceName: group.name,
      resourceType: 'pertenencia a grupo',
      impactDescription: `Se retirará ${selectedUser?.username ?? 'el usuario'} del grupo ${group.name}.`,
      onSuccess: () => restoreFocus('assign-group'),
      onConfirm: () => mutateMembership(
        `${base}/groups/${encodeURIComponent(group.id)}`,
        'DELETE',
        undefined,
        `remove-group-${group.id}`,
        `Pertenencia al grupo ${group.name} retirada.`,
        { rethrow: true }
      )
    })
  }

  const selectedBase = realm && selectedUserId
    ? `/v1/iam/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(selectedUserId)}`
    : ''

  return (
    <section className="space-y-6" data-testid="console-iam-access-page">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">IAM</Badge>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Acceso fino (IAM)</h1>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Gestiona usuarios, roles y grupos del realm de la organización activa: crea principales,
              administra el catálogo y asigna o retira acceso con confirmación.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Organización: {activeTenant?.label ?? 'sin selección'}</Badge>
            {realm ? <Badge variant="secondary">Realm: {realm}</Badge> : null}
          </div>
        </div>
      </header>

      {!realm ? (
        <ConsolePageState
          kind="empty"
          title="Selecciona una organización"
          description="Selecciona una organización en la barra superior para gestionar su IAM."
        />
      ) : null}

      {realm && loading && users.length === 0 && roles.length === 0 && groups.length === 0 ? (
        <ConsolePageState
          kind="loading"
          title="Cargando inventario IAM"
          description="Consultando usuarios, roles y grupos del realm activo."
        />
      ) : null}

      {realm && loadError ? (
        <ConsolePageState
          kind="error"
          title="No se pudo cargar el inventario IAM"
          description={loadError}
          actionLabel="Reintentar"
          onAction={() => void loadCatalog(realm, { preserveSelection: true, focusKey: 'users-search' })}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      ) : null}

      {mutationError ? (
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/5 text-foreground shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/20 text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 max-w-3xl">
              <AlertTitle className="text-base text-foreground">Acción IAM no completada</AlertTitle>
              <AlertDescription className="break-words text-muted-foreground">{mutationError}</AlertDescription>
            </div>
          </div>
        </Alert>
      ) : null}

      <div aria-live="polite" aria-atomic="true" className="empty:hidden">
        {successMessage ? (
          <Alert variant="success" role="status" aria-live="polite" data-testid="iam-access-success">
            {successMessage}
          </Alert>
        ) : null}
      </div>

      {realm && !loadError && !(loading && users.length === 0 && roles.length === 0 && groups.length === 0) ? (
        <>
          <section className="grid gap-4 xl:grid-cols-3" aria-label="Crear recursos IAM">
            <form className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" onSubmit={createUser}>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Crear usuario</h2>
                <p className="text-sm text-muted-foreground">Crea un principal en el realm activo.</p>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="iam-create-user-username">Usuario</Label>
                  <Input
                    id="iam-create-user-username"
                    data-focus-key="create-user-username"
                    value={createUserForm.username}
                    onChange={(event) => setCreateUserForm((current) => ({ ...current, username: event.target.value }))}
                    autoComplete="username"
                    aria-describedby="iam-create-user-help"
                    disabled={busy}
                    placeholder="ada"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="iam-create-user-email">Email</Label>
                  <Input
                    id="iam-create-user-email"
                    type="email"
                    value={createUserForm.email}
                    onChange={(event) => setCreateUserForm((current) => ({ ...current, email: event.target.value }))}
                    autoComplete="email"
                    aria-describedby="iam-create-user-help"
                    disabled={busy}
                    placeholder="ada@example.test"
                  />
                </div>
                <p id="iam-create-user-help" className="text-xs leading-5 text-muted-foreground">
                  Indica un usuario; el email es opcional.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="iam-create-user-password">Contraseña temporal</Label>
                  <Input
                    id="iam-create-user-password"
                    type="password"
                    value={createUserForm.password}
                    onChange={(event) => setCreateUserForm((current) => ({ ...current, password: event.target.value }))}
                    autoComplete="new-password"
                    disabled={busy}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="iam-create-user-role">Rol inicial</Label>
                  <Select
                    id="iam-create-user-role"
                    value={createUserForm.role}
                    onChange={(event) => setCreateUserForm((current) => ({ ...current, role: event.target.value }))}
                    disabled={busy || normalizedRoleOptions.length === 0}
                  >
                    <option value="">Sin rol inicial</option>
                    {normalizedRoleOptions.map((roleName) => (
                      <option key={roleName} value={roleName}>{roleName}</option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" disabled={busy || !createUserForm.username.trim()}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {busy ? 'Creando…' : 'Crear usuario'}
                </Button>
              </div>
            </form>

            <form className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" onSubmit={createRole}>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Crear rol</h2>
                <p className="text-sm text-muted-foreground">Añade un rol asignable al catálogo del realm.</p>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="iam-create-role-name">Nombre del rol</Label>
                  <Input
                    id="iam-create-role-name"
                    data-focus-key="create-role-name"
                    value={createRoleForm.name}
                    onChange={(event) => setCreateRoleForm({ name: event.target.value })}
                    autoComplete="off"
                    disabled={busy}
                    placeholder="tenant_support"
                    required
                  />
                </div>
                <Button type="submit" variant="outline" disabled={busy || !createRoleForm.name.trim()}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {busy ? 'Creando…' : 'Crear rol'}
                </Button>
              </div>
            </form>

            <form className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" onSubmit={createGroup}>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Crear grupo</h2>
                <p className="text-sm text-muted-foreground">Añade un grupo para gestionar pertenencias.</p>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="iam-create-group-name">Nombre del grupo</Label>
                  <Input
                    id="iam-create-group-name"
                    data-focus-key="create-group-name"
                    value={createGroupForm.name}
                    onChange={(event) => setCreateGroupForm({ name: event.target.value })}
                    autoComplete="off"
                    disabled={busy}
                    placeholder="soporte"
                    required
                  />
                </div>
                <Button type="submit" variant="outline" disabled={busy || !createGroupForm.name.trim()}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {busy ? 'Creando…' : 'Crear grupo'}
                </Button>
              </div>
            </form>
          </section>

          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <section className="min-w-0 rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="iam-users-heading" aria-busy={loading}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 id="iam-users-heading" className="text-lg font-semibold">Usuarios ({filteredUsers.length})</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {loading ? 'Actualizando inventario…' : userTotal > users.length ? `${users.length} de ${userTotal} cargados.` : 'Busca y pagina el inventario del realm activo.'}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={loading || busy} aria-busy={loading} onClick={() => void loadCatalog(realm, { preserveSelection: true, focusKey: 'users-search' })}>
                  <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
                  {loading ? 'Recargando…' : 'Recargar'}
                </Button>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="iam-users-search">Buscar usuarios</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="iam-users-search"
                      data-focus-key="users-search"
                      className="pl-9"
                      value={userSearch}
                      onChange={(event) => setUserSearch(event.target.value)}
                      type="search"
                      autoComplete="off"
                      aria-describedby="iam-users-pagination-status"
                      placeholder="Usuario, email o id"
                    />
                  </div>
                </div>
                <p id="iam-users-pagination-status" className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  Página {currentPage + 1} de {totalPages}
                </p>
              </div>

              {users.length === 0 && !loading ? (
                <div className="mt-4">
                  <ConsolePageState
                    kind="empty"
                    title="No hay usuarios IAM"
                    description="Crea el primer usuario del realm para empezar a asignar roles y grupos."
                    actionLabel="Crear usuario"
                    onAction={() => restoreFocus('create-user-username')}
                  />
                </div>
              ) : null}

              {users.length > 0 && filteredUsers.length === 0 ? (
                <div className="mt-4">
                  <ConsolePageState
                    kind="empty"
                    title="Sin resultados"
                    description="No hay usuarios que coincidan con la búsqueda actual."
                    actionLabel="Limpiar búsqueda"
                    onAction={clearUserSearch}
                  />
                </div>
              ) : null}

              {pagedUsers.length > 0 ? (
                <>
                  <Table className="min-w-[32rem]" containerClassName="mt-4" aria-label="Usuarios IAM del realm activo">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[9rem]">Usuario</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-[7rem]">Estado</TableHead>
                        <TableHead className="w-[5.5rem] px-2 text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedUsers.map((user) => {
                        const userId = getUserId(user)
                        const selected = selectedUserId === userId
                        const suspended = isUserSuspended(user)
                        return (
                          <TableRow key={userId} className={selected ? 'bg-primary/10' : undefined}>
                            <TableCell>
                              <button
                                type="button"
                                data-focus-key={`user-row-${userId}`}
                                onClick={() => setSelectedUserId(userId)}
                                className="text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-pressed={selected}
                              >
                                {user.username}
                              </button>
                              <span className="mt-1 block font-mono text-xs text-muted-foreground">{userId}</span>
                            </TableCell>
                            <TableCell className="break-words text-muted-foreground">{user.email ?? 'sin email'}</TableCell>
                            <TableCell>
                              <Badge variant={suspended ? 'outline' : 'secondary'}>{suspended ? 'suspendido' : 'activo'}</Badge>
                            </TableCell>
                            <TableCell className="px-2 text-right">
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-9 px-0"
                                  data-focus-key={`status-user-row-${userId}`}
                                  disabled={busy}
                                  title={suspended ? 'Habilitar' : 'Suspender'}
                                  onClick={() => void setUserStatus(user, suspended, `status-user-row-${userId}`)}
                                >
                                  {suspended ? <UserCheck className="h-4 w-4" aria-hidden="true" /> : <UserMinus className="h-4 w-4" aria-hidden="true" />}
                                  <span className="sr-only">{suspended ? 'Habilitar' : 'Suspender'}</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="w-9 px-0"
                                  data-focus-key={`delete-user-${userId}`}
                                  disabled={busy}
                                  title="Eliminar"
                                  onClick={() => confirmDeleteUser(user)}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  <span className="sr-only">Eliminar</span>
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Mostrando {currentPage * USERS_PAGE_SIZE + 1}-{Math.min((currentPage + 1) * USERS_PAGE_SIZE, filteredUsers.length)} de {filteredUsers.length}
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={currentPage === 0} aria-label="Página anterior de usuarios" onClick={() => setUserPage((page) => Math.max(0, page - 1))}>
                        Anterior
                      </Button>
                      <Button type="button" variant="outline" size="sm" disabled={currentPage >= totalPages - 1} aria-label="Página siguiente de usuarios" onClick={() => setUserPage((page) => Math.min(totalPages - 1, page + 1))}>
                        Siguiente
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
            </section>

            <section className="min-w-0 rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="iam-user-detail-heading">
              <h2 id="iam-user-detail-heading" className="text-lg font-semibold">
                {selectedUser ? `Acceso de ${selectedUser.username}` : 'Selecciona un usuario'}
              </h2>
              {!selectedUser ? (
                <div className="mt-4">
                  <ConsolePageState
                    kind="empty"
                    title="Sin usuario seleccionado"
                    description="Elige un usuario de la lista para gestionar su estado, roles y grupos."
                  />
                </div>
              ) : detailLoading ? (
                <div className="mt-4">
                  <ConsolePageState
                    kind="loading"
                    title="Cargando detalle"
                    description="Consultando roles y grupos asignados al usuario seleccionado."
                  />
                </div>
              ) : (
                <div className="mt-4 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/40 p-4">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-foreground">{selectedUser.email ?? 'sin email'}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{getUserId(selectedUser)}</p>
                    </div>
                    <Badge variant={isUserSuspended(selectedUser) ? 'outline' : 'secondary'}>
                      {isUserSuspended(selectedUser) ? 'suspendido' : 'activo'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      data-focus-key={`status-user-detail-${getUserId(selectedUser)}`}
                      disabled={busy}
                      onClick={() => void setUserStatus(selectedUser, isUserSuspended(selectedUser), `status-user-detail-${getUserId(selectedUser)}`)}
                    >
                      {isUserSuspended(selectedUser) ? <UserCheck className="h-4 w-4" aria-hidden="true" /> : <UserMinus className="h-4 w-4" aria-hidden="true" />}
                      {isUserSuspended(selectedUser) ? 'Habilitar usuario' : 'Suspender usuario'}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      data-focus-key={`delete-user-${getUserId(selectedUser)}`}
                      disabled={busy}
                      onClick={() => confirmDeleteUser(selectedUser)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Eliminar usuario
                    </Button>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Roles asignados</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {userRoles.length === 0 ? <span className="text-sm text-muted-foreground">Sin roles.</span> : null}
                      {userRoles.map((role) => {
                        const roleName = getRoleName(role)
                        return (
                          <Badge key={roleName} variant="outline" className="gap-1">
                            {roleName}
                            {!roleName.startsWith('default-roles') ? (
                              <button
                                type="button"
                                data-focus-key={`remove-role-${roleName}`}
                                disabled={busy}
                                aria-label={`Quitar rol ${roleName}`}
                                onClick={() => confirmRemoveRole(role)}
                                className="ml-1 rounded-sm text-destructive hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            ) : null}
                          </Badge>
                        )
                      })}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor="iam-assign-role">Asignar rol</Label>
                      <Select
                        id="iam-assign-role"
                        aria-label="Rol a asignar"
                        data-focus-key="assign-role"
                        value=""
                        disabled={busy || assignableRoles.length === 0}
                        onChange={(event) => {
                          const value = event.target.value
                          if (!value) return
                          void mutateMembership(
                            `${selectedBase}/role-assignments`,
                            'POST',
                            { roles: [value] },
                            'assign-role',
                            `Rol ${value} asignado.`
                          )
                        }}
                      >
                        <option value="">{assignableRoles.length > 0 ? 'Asignar rol…' : 'No hay roles disponibles'}</option>
                        {assignableRoles.map((role) => {
                          const roleName = getRoleName(role)
                          return <option key={roleName} value={roleName}>{roleName}</option>
                        })}
                      </Select>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Grupos</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {userGroups.length === 0 ? <span className="text-sm text-muted-foreground">Sin grupos.</span> : null}
                      {userGroups.map((group) => (
                        <Badge key={group.id} variant="outline" className="gap-1">
                          {group.name}
                          <button
                            type="button"
                            data-focus-key={`remove-group-${group.id}`}
                            disabled={busy}
                            aria-label={`Quitar de grupo ${group.name}`}
                            onClick={() => confirmRemoveGroup(group)}
                            className="ml-1 rounded-sm text-destructive hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor="iam-assign-group">Añadir a grupo</Label>
                      <Select
                        id="iam-assign-group"
                        aria-label="Grupo a asignar"
                        data-focus-key="assign-group"
                        value=""
                        disabled={busy || assignableGroups.length === 0}
                        onChange={(event) => {
                          const value = event.target.value
                          if (!value) return
                          const group = assignableGroups.find((entry) => entry.id === value)
                          void mutateMembership(
                            `${selectedBase}/groups/${encodeURIComponent(value)}`,
                            'PUT',
                            undefined,
                            'assign-group',
                            `Usuario añadido al grupo ${group?.name ?? value}.`
                          )
                        }}
                      >
                        <option value="">{assignableGroups.length > 0 ? 'Añadir a grupo…' : 'No hay grupos disponibles'}</option>
                        {assignableGroups.map((group) => (
                          <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      ) : null}

      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </section>
  )
}
