import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PermissionDeniedNotice } from '@/components/console/PermissionDeniedNotice'
import { ReadOnlyActionBadge } from '@/components/console/ReadOnlyActionBadge'
import { formatConsoleEnumLabel, useConsoleContext } from '@/lib/console-context'
import { useConsolePermissions } from '@/lib/console-permissions'
import { requestConsoleSessionJson } from '@/lib/console-session'

interface PageInfo {
  after?: string | null
  nextCursor?: string | null
  size: number
}

interface ErrorResponse {
  message?: string
}

interface IamProviderCompatibility {
  provider: 'keycloak'
  contractVersion: string
  supportedVersions: string[]
  adminApiStability: 'stable_v1'
}

interface IamAttributes {
  [key: string]: string[]
}

type IamRequiredAction = 'CONFIGURE_TOTP' | 'UPDATE_PASSWORD' | 'UPDATE_PROFILE' | 'VERIFY_EMAIL'

type EntityState = 'draft' | 'provisioning' | 'pending_activation' | 'active' | 'suspended' | 'soft_deleted' | 'deleted'

interface IamUser {
  userId: string
  realmId: string
  username: string
  email?: string
  enabled: boolean
  state?: EntityState
  realmRoles?: string[]
  requiredActions?: IamRequiredAction[]
  attributes: IamAttributes
  providerCompatibility: IamProviderCompatibility
}

interface IamRole {
  realmId: string
  roleName: string
  description?: string
  composite: boolean
  compositeRoles: string[]
  attributes: IamAttributes
  providerCompatibility: IamProviderCompatibility
}

interface IamUserCollectionResponse {
  items: IamUser[]
  page: PageInfo
  compatibility: IamProviderCompatibility
}

interface IamRoleCollectionResponse {
  items: IamRole[]
  page: PageInfo
  compatibility: IamProviderCompatibility
}

function getApiErrorStatus(rawError: unknown): number | undefined {
  return typeof rawError === 'object' && rawError !== null && 'status' in rawError && typeof (rawError as { status?: unknown }).status === 'number'
    ? (rawError as { status: number }).status
    : undefined
}

function getApiErrorMessage(rawError: unknown, fallback: string): string {
  if (typeof rawError === 'object' && rawError !== null) {
    if ('message' in rawError && typeof rawError.message === 'string' && rawError.message.trim()) {
      return rawError.message
    }

    if ('body' in rawError) {
      const body = rawError.body as ErrorResponse | undefined
      if (body?.message?.trim()) {
        return body.message
      }
    }
  }

  return fallback
}

async function listRealmUsers(realmId: string): Promise<IamUserCollectionResponse> {
  const searchParams = new URLSearchParams({ 'page[size]': '100' })
  return requestConsoleSessionJson<IamUserCollectionResponse>(`/v1/iam/realms/${realmId}/users?${searchParams.toString()}`)
}

async function listRealmRoles(realmId: string): Promise<IamRoleCollectionResponse> {
  const searchParams = new URLSearchParams({ 'page[size]': '100' })
  return requestConsoleSessionJson<IamRoleCollectionResponse>(`/v1/iam/realms/${realmId}/roles?${searchParams.toString()}`)
}

export function ConsoleMembersPage() {
  const { activeTenant } = useConsoleContext()
  // #761: tenant.members.manage is denied to tenant_viewer/tenant_developer in
  // authorization-model.json — the directory (users/roles list) stays readable for them, only the
  // "Crear usuario" affordance is gated.
  const { can, denyReason, highestRoleLabel } = useConsolePermissions()
  const canManageMembers = can('tenant.members.manage')
  const membersManageDenyReason = denyReason('tenant.members.manage')
  const realmId = activeTenant?.consoleUserRealm ?? null
  const [users, setUsers] = useState<IamUser[]>([])
  const [roles, setRoles] = useState<IamRole[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [rolesLoading, setRolesLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [usersReloadKey, setUsersReloadKey] = useState(0)
  const [rolesReloadKey, setRolesReloadKey] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)

  const reloadUsers = useCallback(() => {
    setUsersReloadKey((current) => current + 1)
  }, [])

  const reloadRoles = useCallback(() => {
    setRolesReloadKey((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!realmId) {
      setUsers([])
      setUsersLoading(false)
      setUsersError(null)
      return
    }

    let cancelled = false
    const currentRealmId = realmId

    async function loadUsers() {
      setUsersLoading(true)
      setUsersError(null)

      try {
        const response = await listRealmUsers(currentRealmId)
        if (!cancelled) {
          setUsers(response.items)
        }
      } catch (error) {
        if (!cancelled) {
          setUsers([])
          setUsersError(getApiErrorMessage(error, 'No se pudieron cargar los usuarios IAM del realm.'))
        }
      } finally {
        if (!cancelled) {
          setUsersLoading(false)
        }
      }
    }

    void loadUsers()

    return () => {
      cancelled = true
    }
  }, [realmId, usersReloadKey])

  useEffect(() => {
    if (!realmId) {
      setRoles([])
      setRolesLoading(false)
      setRolesError(null)
      return
    }

    let cancelled = false
    const currentRealmId = realmId

    async function loadRoles() {
      setRolesLoading(true)
      setRolesError(null)

      try {
        const response = await listRealmRoles(currentRealmId)
        if (!cancelled) {
          setRoles(response.items)
        }
      } catch (error) {
        if (!cancelled) {
          setRoles([])
          setRolesError(getApiErrorMessage(error, 'No se pudieron cargar los roles IAM del realm.'))
        }
      } finally {
        if (!cancelled) {
          setRolesLoading(false)
        }
      }
    }

    void loadRoles()

    return () => {
      cancelled = true
    }
  }, [realmId, rolesReloadKey])

  const headerDescription = useMemo(() => {
    if (!activeTenant) {
      return 'Selecciona una organización para consultar los miembros y roles de su realm IAM de consola.'
    }

    if (!realmId) {
      return 'La organización activa todavía no expone un realm IAM de consola asociado.'
    }

    return `Realm IAM activo: ${realmId}`
  }, [activeTenant, realmId])

  if (!activeTenant) {
    return <ConsoleMembersEmptyState message="Selecciona una organización para gestionar sus miembros y roles." />
  }

  if (!realmId) {
    return <ConsoleMembersEmptyState message="Esta organización no tiene un realm de consola IAM configurado." />
  }

  return (
    <section className="space-y-6" aria-label="Miembros de la organización activa">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Miembros</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Miembros y roles de la organización</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{headerDescription}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Organización: {activeTenant.label}</Badge>
            <Badge variant="secondary">Realm: {realmId}</Badge>
            {canManageMembers ? (
              <Button type="button" onClick={() => setCreateOpen((current) => !current)}>
                {createOpen ? 'Cerrar' : 'Crear usuario'}
              </Button>
            ) : (
              // Page-level create CTA hidden (not disabled) for a role that can never use it (#761).
              // Shared ReadOnlyActionBadge keeps the amber tone + Lock cue + sr-only recourse aligned
              // with the Flows/Workspaces indicators.
              <ReadOnlyActionBadge
                testId="members-read-only-indicator"
                roleLabel={highestRoleLabel}
                deniedAction="crear usuarios"
                reason={membersManageDenyReason}
              />
            )}
          </div>
        </div>
      </header>

      {createOpen && canManageMembers ? (
        <CreateUserPanel
          tenantId={activeTenant.tenantId}
          roles={roles}
          onCreated={() => {
            setCreateOpen(false)
            reloadUsers()
          }}
        />
      ) : null}

      <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-members-users-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="console-members-users-heading" className="text-lg font-semibold text-foreground">
              Usuarios IAM
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Usuarios disponibles en el realm de consola de la organización activa.</p>
          </div>
          {usersError ? (
            <Button type="button" variant="outline" size="sm" onClick={reloadUsers}>
              Reintentar usuarios
            </Button>
          ) : null}
        </div>

        {usersLoading ? <ConsoleSectionLoading label="Cargando usuarios IAM…" /> : null}
        {!usersLoading && usersError ? <ConsoleSectionError message={usersError} actionLabel="Reintentar usuarios" onRetry={reloadUsers} /> : null}
        {!usersLoading && !usersError && users.length === 0 ? <ConsoleSectionEmpty message="No hay usuarios IAM registrados en este realm." /> : null}
        {!usersLoading && !usersError && users.length > 0 ? <UsersTable users={users} /> : null}
      </section>

      <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="console-members-roles-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="console-members-roles-heading" className="text-lg font-semibold text-foreground">
              Roles IAM
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Roles definidos en el realm de consola para esta organización.</p>
          </div>
          {rolesError ? (
            <Button type="button" variant="outline" size="sm" onClick={reloadRoles}>
              Reintentar roles
            </Button>
          ) : null}
        </div>

        {rolesLoading ? <ConsoleSectionLoading label="Cargando roles IAM…" /> : null}
        {!rolesLoading && rolesError ? <ConsoleSectionError message={rolesError} actionLabel="Reintentar roles" onRetry={reloadRoles} /> : null}
        {!rolesLoading && !rolesError && roles.length === 0 ? <ConsoleSectionEmpty message="No hay roles IAM registrados en este realm." /> : null}
        {!rolesLoading && !rolesError && roles.length > 0 ? <RolesTable roles={roles} /> : null}
      </section>
    </section>
  )
}

function CreateUserPanel({
  tenantId,
  roles,
  onCreated
}: {
  tenantId: string
  roles: IamRole[]
  onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('tenant_developer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const { denyReason } = useConsolePermissions()

  const assignableRoles = roles.map((entry) => entry.roleName).filter((name) => name && !name.startsWith('default-roles'))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password.trim()) return
    setBusy(true)
    setError(null)
    setPermissionDenied(false)
    try {
      await requestConsoleSessionJson(`/v1/tenants/${encodeURIComponent(tenantId)}/users`, {
        method: 'POST',
        body: {
          username: username.trim(),
          email: email.trim() || undefined,
          password: password.trim(),
          roles: role ? [role] : undefined
        }
      })
      setUsername('')
      setEmail('')
      setPassword('')
      onCreated()
    } catch (rawError) {
      // #761: a 403 gets the shared, role-aware PermissionDeniedNotice instead of the raw backend
      // message — this is defense-in-depth (the CTA above is already hidden for roles denied
      // `tenant.members.manage`), reached only by a stale-session race.
      if (getApiErrorStatus(rawError) === 403) {
        setPermissionDenied(true)
      } else {
        setError(getApiErrorMessage(rawError, 'No se pudo crear el usuario en el realm de la organización.'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-label="Crear usuario en el realm de la organización">
      <h2 className="text-lg font-semibold text-foreground">Crear usuario</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Crea un usuario directamente en el realm de la organización (Keycloak) y asígnale un rol inicial.
      </p>
      {permissionDenied ? (
        <div className="mt-3">
          <PermissionDeniedNotice reason={denyReason('tenant.members.manage') ?? 'No tienes permisos para crear usuarios en esta organización.'} />
        </div>
      ) : error ? (
        <div role="alert" className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Usuario</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="jdoe"
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jdoe@example.com"
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Rol inicial</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {assignableRoles.length === 0 ? <option value="tenant_developer">Desarrollador de organización</option> : null}
            {assignableRoles.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || !username.trim() || !password.trim()}>
            {busy ? 'Creando…' : 'Crear usuario'}
          </Button>
        </div>
      </form>
    </section>
  )
}

function ConsoleMembersEmptyState({ message }: { message: string }) {
  return (
    <section data-testid="console-section-empty" className="rounded-3xl border border-dashed border-border bg-card/40 p-10 text-center shadow-sm">
      <Badge variant="outline">Miembros</Badge>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Miembros de la organización</h1>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{message}</p>
    </section>
  )
}

function ConsoleSectionLoading({ label }: { label: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-border/70 bg-background/60 p-4" aria-busy="true">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

function ConsoleSectionEmpty({ message }: { message: string }) {
  return <p data-testid="console-section-empty" className="mt-4 text-sm text-muted-foreground">{message}</p>
}

function ConsoleSectionError({
  actionLabel,
  message,
  onRetry
}: {
  actionLabel: string
  message: string
  onRetry: () => void
}) {
  return (
    <div role="alert" className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        {actionLabel}
      </Button>
    </div>
  )
}

function UsersTable({ users }: { users: IamUser[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <caption className="sr-only">Listado de usuarios IAM del realm activo</caption>
        <thead>
          <tr className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <th scope="col" className="px-3 py-3 font-medium">Usuario</th>
            <th scope="col" className="px-3 py-3 font-medium">Email</th>
            <th scope="col" className="px-3 py-3 font-medium">Estado</th>
            <th scope="col" className="px-3 py-3 font-medium">Ciclo de vida</th>
            <th scope="col" className="px-3 py-3 font-medium">Roles</th>
            <th scope="col" className="px-3 py-3 font-medium">Acciones requeridas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/80">
          {users.map((user) => (
            <tr key={user.userId}>
              <td className="px-3 py-4">
                <div className="font-medium text-foreground">{user.username}</div>
              </td>
              <td className="px-3 py-4 text-muted-foreground">{user.email ?? 'No disponible'}</td>
              <td className="px-3 py-4">
                <Badge variant={user.enabled ? 'secondary' : 'outline'}>{user.enabled ? 'Activo' : 'Desactivado'}</Badge>
              </td>
              <td className="px-3 py-4 text-muted-foreground">{formatConsoleEnumLabel(user.state ?? null)}</td>
              <td className="px-3 py-4">
                {user.realmRoles && user.realmRoles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {user.realmRoles.map((role) => (
                      <Badge key={role} variant="outline">{role}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sin roles</span>
                )}
              </td>
              <td className="px-3 py-4">
                {user.requiredActions && user.requiredActions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {user.requiredActions.map((action) => (
                      <Badge key={action} variant="outline">{action}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sin pendientes</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RolesTable({ roles }: { roles: IamRole[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-left text-sm">
        <caption className="sr-only">Listado de roles IAM del realm activo</caption>
        <thead>
          <tr className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            <th scope="col" className="px-3 py-3 font-medium">Rol</th>
            <th scope="col" className="px-3 py-3 font-medium">Descripción</th>
            <th scope="col" className="px-3 py-3 font-medium">Tipo</th>
            <th scope="col" className="px-3 py-3 font-medium">Roles compuestos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/80">
          {roles.map((role) => (
            <tr key={role.roleName}>
              <td className="px-3 py-4 font-medium text-foreground">{role.roleName}</td>
              <td className="px-3 py-4 text-muted-foreground">{role.description?.trim() || 'Sin descripción'}</td>
              <td className="px-3 py-4">
                <Badge variant={role.composite ? 'secondary' : 'outline'}>{role.composite ? 'Compuesto' : 'Simple'}</Badge>
              </td>
              <td className="px-3 py-4">
                {role.composite && role.compositeRoles.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {role.compositeRoles.map((compositeRole) => (
                      <Badge key={compositeRole} variant="outline">{compositeRole}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sin roles hijo</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
