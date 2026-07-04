import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="members-create-username">Usuario</Label>
          <Input
            id="members-create-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="jdoe"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="members-create-email">Email</Label>
          <Input
            id="members-create-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jdoe@example.com"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="members-create-password">Contraseña</Label>
          <Input
            id="members-create-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="members-create-role">Rol inicial</Label>
          <Select id="members-create-role" value={role} onChange={(event) => setRole(event.target.value)}>
            {assignableRoles.length === 0 ? <option value="tenant_developer">Desarrollador de organización</option> : null}
            {assignableRoles.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
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
    <Table className="mt-4" aria-label="Listado de usuarios IAM del realm activo">
      <TableHeader>
        <TableRow>
          <TableHead>Usuario</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Ciclo de vida</TableHead>
          <TableHead>Roles</TableHead>
          <TableHead>Acciones requeridas</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.userId}>
            <TableCell className="font-medium text-foreground">{user.username}</TableCell>
            <TableCell className="text-muted-foreground">{user.email ?? 'No disponible'}</TableCell>
            <TableCell>
              <Badge variant={user.enabled ? 'secondary' : 'outline'}>{user.enabled ? 'Activo' : 'Desactivado'}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{formatConsoleEnumLabel(user.state ?? null)}</TableCell>
            <TableCell>
              {user.realmRoles && user.realmRoles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {user.realmRoles.map((role) => (
                    <Badge key={role} variant="outline">{role}</Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">Sin roles</span>
              )}
            </TableCell>
            <TableCell>
              {user.requiredActions && user.requiredActions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {user.requiredActions.map((action) => (
                    <Badge key={action} variant="outline">{action}</Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">Sin pendientes</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function RolesTable({ roles }: { roles: IamRole[] }) {
  return (
    <Table className="mt-4" aria-label="Listado de roles IAM del realm activo">
      <TableHeader>
        <TableRow>
          <TableHead>Rol</TableHead>
          <TableHead>Descripción</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Roles compuestos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.map((role) => (
          <TableRow key={role.roleName}>
            <TableCell className="font-medium text-foreground">{role.roleName}</TableCell>
            <TableCell className="text-muted-foreground">{role.description?.trim() || 'Sin descripción'}</TableCell>
            <TableCell>
              <Badge variant={role.composite ? 'secondary' : 'outline'}>{role.composite ? 'Compuesto' : 'Simple'}</Badge>
            </TableCell>
            <TableCell>
              {role.composite && role.compositeRoles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {role.compositeRoles.map((compositeRole) => (
                    <Badge key={compositeRole} variant="outline">{compositeRole}</Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">Sin roles hijo</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
