import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { ApiError, JsonValue } from '@/lib/http'

interface IamUser {
  id: string
  username: string
  email: string | null
  enabled: boolean
}
interface IamRole {
  id?: string
  name: string
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

const IAM_ACCESS_ERROR_MESSAGES: Record<string, string> = {
  IAM_ASSIGN_ROLE_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_REMOVE_ROLE_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_GROUP_ADD_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_GROUP_REMOVE_FAILED: 'No se pudo actualizar el acceso IAM. Inténtalo de nuevo o contacta con soporte si el problema continúa.',
  IAM_GET_USER_FAILED: 'No se pudo cargar el detalle del usuario IAM.',
  IAM_GET_ROLE_FAILED: 'No se pudo cargar la información de roles IAM.'
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

export function ConsoleIamAccessPage() {
  const { activeTenant, activeTenantId } = useConsoleContext()
  // Falcone tenancy model: the realm name == the tenantId.
  const realm = activeTenantId

  const [users, setUsers] = useState<IamUser[]>([])
  const [roles, setRoles] = useState<IamRole[]>([])
  const [groups, setGroups] = useState<IamGroup[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [userRoles, setUserRoles] = useState<IamRole[]>([])
  const [userGroups, setUserGroups] = useState<IamGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(async (realmId: string) => {
    setLoading(true)
    setError(null)
    setSelectedUserId(null)
    setUserRoles([])
    setUserGroups([])
    try {
      const base = `/v1/iam/realms/${encodeURIComponent(realmId)}`
      const [usersRes, rolesRes, groupsRes] = await Promise.all([
        requestConsoleSessionJson<ListUsersResponse>(`${base}/users`),
        requestConsoleSessionJson<ListRolesResponse>(`${base}/roles`),
        requestConsoleSessionJson<ListGroupsResponse>(`${base}/groups`)
      ])
      setUsers(usersRes.items ?? [])
      setRoles(rolesRes.items ?? [])
      setGroups(groupsRes.items ?? [])
    } catch (rawError) {
      setError(errMsg(rawError, 'No se pudo cargar el IAM del tenant activo.'))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUserDetail = useCallback(async (realmId: string, userId: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const base = `/v1/iam/realms/${encodeURIComponent(realmId)}/users/${encodeURIComponent(userId)}`
      const [rolesRes, groupsRes] = await Promise.all([
        requestConsoleSessionJson<ListRolesResponse>(`${base}/roles`),
        requestConsoleSessionJson<ListGroupsResponse>(`${base}/groups`)
      ])
      setUserRoles(rolesRes.items ?? [])
      setUserGroups(groupsRes.items ?? [])
    } catch (rawError) {
      setError(errMsg(rawError, 'No se pudo cargar el detalle del usuario.'))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!realm) {
      setUsers([])
      setRoles([])
      setGroups([])
      setSelectedUserId(null)
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

  async function mutate(path: string, method: 'POST' | 'DELETE' | 'PUT', body?: JsonValue) {
    if (!realm || !selectedUserId) return
    setBusy(true)
    setError(null)
    try {
      await requestConsoleSessionJson(path, { method, body: body ?? ({} as JsonValue) })
      await loadUserDetail(realm, selectedUserId)
    } catch (rawError) {
      setError(errMsg(rawError, 'La operación de IAM no pudo completarse.'))
    } finally {
      setBusy(false)
    }
  }

  const base = realm && selectedUserId
    ? `/v1/iam/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(selectedUserId)}`
    : ''
  const assignedRoleNames = new Set(userRoles.map((role) => role.name))
  const assignedGroupIds = new Set(userGroups.map((group) => group.id))
  const assignableRoles = roles.filter((role) => !assignedRoleNames.has(role.name) && !role.name.startsWith('default-roles'))
  const assignableGroups = groups.filter((group) => !assignedGroupIds.has(group.id))
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null

  return (
    <main className="space-y-6" data-testid="console-iam-access-page">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="space-y-2">
          <Badge variant="outline">IAM</Badge>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Acceso fino (IAM)</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona usuarios, roles y grupos del realm del tenant activo: asigna o retira roles y administra la
            pertenencia a grupos.
          </p>
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          Tenant activo: {activeTenant?.label ?? 'Sin tenant seleccionado'}
          {realm ? <span className="ml-2 font-mono text-xs">realm {realm}</span> : null}
        </div>
      </header>

      {!realm ? (
        <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <p className="text-sm text-muted-foreground">Selecciona un tenant en la barra superior para gestionar su IAM.</p>
        </section>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/5 text-foreground shadow-sm">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/20 text-destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 max-w-3xl">
              <AlertTitle className="text-base text-foreground">Acción IAM no completada</AlertTitle>
              <AlertDescription className="break-words text-muted-foreground">{error}</AlertDescription>
            </div>
          </div>
        </Alert>
      ) : null}

      {realm ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Usuarios ({users.length})</h2>
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => realm && void loadCatalog(realm)}>
                Recargar
              </Button>
            </div>
            {loading ? (
              <p className="mt-2 text-sm text-muted-foreground">Cargando usuarios…</p>
            ) : users.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No hay usuarios en este realm.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {users.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(user.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                        selectedUserId === user.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{user.username}</span>
                        <span className={`block text-xs ${selectedUserId === user.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                          {user.email ?? 'sin email'}
                        </span>
                      </span>
                      {!user.enabled ? <Badge variant="outline">deshabilitado</Badge> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
            <h2 className="text-lg font-semibold">
              {selectedUser ? `Acceso de ${selectedUser.username}` : 'Selecciona un usuario'}
            </h2>
            {!selectedUser ? (
              <p className="mt-2 text-sm text-muted-foreground">Elige un usuario de la lista para gestionar sus roles y grupos.</p>
            ) : detailLoading ? (
              <p className="mt-2 text-sm text-muted-foreground">Cargando detalle…</p>
            ) : (
              <div className="mt-4 space-y-6">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Roles asignados</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {userRoles.length === 0 ? <span className="text-sm text-muted-foreground">Sin roles.</span> : null}
                    {userRoles.map((role) => (
                      <span key={role.name} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs">
                        {role.name}
                        {!role.name.startsWith('default-roles') ? (
                          <button
                            type="button"
                            disabled={busy}
                            title="Quitar rol"
                            onClick={() => void mutate(`${base}/role-assignments`, 'DELETE', { roles: [role.name] })}
                            className="ml-1 text-destructive hover:opacity-80"
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                  {assignableRoles.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Rol a asignar"
                        defaultValue=""
                        disabled={busy}
                        onChange={(event) => {
                          const value = event.target.value
                          event.target.value = ''
                          if (value) void mutate(`${base}/role-assignments`, 'POST', { roles: [value] })
                        }}
                        className="h-9 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Asignar rol…</option>
                        {assignableRoles.map((role) => (
                          <option key={role.name} value={role.name}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">Grupos</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {userGroups.length === 0 ? <span className="text-sm text-muted-foreground">Sin grupos.</span> : null}
                    {userGroups.map((group) => (
                      <span key={group.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs">
                        {group.name}
                        <button
                          type="button"
                          disabled={busy}
                          title="Quitar de grupo"
                          onClick={() => void mutate(`${base}/groups/${encodeURIComponent(group.id)}`, 'DELETE')}
                          className="ml-1 text-destructive hover:opacity-80"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  {assignableGroups.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Grupo a asignar"
                        defaultValue=""
                        disabled={busy}
                        onChange={(event) => {
                          const value = event.target.value
                          event.target.value = ''
                          if (value) void mutate(`${base}/groups/${encodeURIComponent(value)}`, 'PUT')
                        }}
                        className="h-9 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Añadir a grupo…</option>
                        {assignableGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  )
}
