# Console permission-aware tenant roles (issue #761)

Before this change, the web console performed no client-side role differentiation for tenant roles:
a `tenant_viewer` (read-only observer) or `tenant_developer` (directory read) saw the identical
operator surface as a `tenant_owner` — the role was only visible as a raw token buried inside the
opened avatar dropdown, and every create/edit/delete affordance rendered enabled regardless of role,
dead-ending in a backend `403`. This page documents the permission-aware behavior added to close that
gap. It is a client-side, defense-in-depth affordance layer — the backend `403` remains the
authoritative decision.

## The single permission source

`apps/web-console/src/lib/console-permissions.ts` exports `useConsolePermissions()` (and the pure
`getConsolePermissions(roles)` for non-hook call sites). It reads `platformRoles` off the persisted
console session (`ConsoleSessionPrincipal.platformRoles` — no new backend call) and mirrors
`services/internal-contracts/src/authorization-model.json`'s `permission_matrix.tenant` at the
granularity the console's affordances need:

```ts
interface ConsolePermissions {
  roles: string[]
  isReadOnly: boolean           // true when no write-capable role is present (fail-closed)
  highestRoleLabel: string      // e.g. "Viewer · solo lectura", "Propietario"
  highestRoleTone: 'read-only' | 'write-capable' | 'unknown'
  can(action: PermissionAction): boolean
  denyReason(action: PermissionAction): string | null
}
```

`PermissionAction` covers `tenant.create`, `tenant.workspaces.create`, `tenant.members.manage`,
`iam.clients.manage`, `workspace.write`, and `tenant.audit.read` — one entry per affordance family the
console actually renders, not a full mirror of every leaf action in the authorization model (that
would add drift risk for no UI value).

### The role matrix

| Role | `isReadOnly` | `tenant.workspaces.create` / `tenant.members.manage` | `workspace.write` | `tenant.audit.read` | `iam.clients.manage` | `tenant.create` |
| --- | --- | --- | --- | --- | --- | --- |
| `tenant_viewer` | yes | no | no | **yes** | no | no |
| `tenant_developer` | yes | no | no | **no** | no | no |
| `tenant_admin` | no | yes | yes | yes | no | no |
| `tenant_owner` | no | yes | yes | yes | no | no |
| `workspace_admin` / `workspace_owner` | no | yes | yes | yes | yes | no |
| `superadmin` / `platform_admin` / `platform_operator` / `platform_team` | no | yes | yes | yes | yes | yes |
| empty or unrecognized role list | yes (fail-closed) | no | no | no | no | no |

`tenant_viewer` and `tenant_developer` differ in exactly one place: the viewer is allowed
`tenant.audit.read`, the developer is not — matching the model's role summaries ("Read-only tenant
observer for dashboards, audit evidence, and effective-permission visibility" vs. "Reads tenant and
workspace directory context for collaboration without gaining workspace runtime permissions"). An
empty or unrecognized role list fails closed for every write action but is never mislabeled as a
write-capable role.

### Existing call sites now delegate to it

- `apps/web-console/src/lib/console-wizards.ts::useWizardPermissionCheck` maps each
  `WizardPermission` (`create_tenant`, `create_workspace`, `manage_iam`, `invite_member`,
  `provision_database`, `publish_function`) onto a `PermissionAction` and delegates — see
  `docs/reference/architecture/console-wizard-permission-gates.md`.
- `apps/web-console/src/lib/structural-write-access.ts::canPerformStructuralWrites` delegates to the
  dedicated, exported `STRUCTURAL_WRITE_ADMIN_ROLES` set (not the broader
  `WORKSPACE_WRITE_CAPABLE_ROLES`) — a backend-parity set that mirrors
  `apps/control-plane/src/runtime/auth-roles.mjs::WRITE_CAPABLE_ADMIN_ROLES` exactly, so it excludes
  `platform_operator`/`platform_team` (the two roles `WORKSPACE_WRITE_CAPABLE_ROLES` treats as a
  console-wide bypass but the backend does not authorize for a structural write).
- `ConsoleQuotasPage.tsx` sources its `platformRoles` array from `useConsolePermissions()` instead of
  a second, independent `readConsoleShellSession()` call.

## Role indicator in the chrome

`ConsoleShellLayout.tsx` renders a `RoleBadge` in the header's identity zone, immediately left of the
avatar button — the one wrapper that survives every breakpoint (unlike the `md:block` name/email
column or the `xl:flex` context controls). It shows the humanized `highestRoleLabel`:

- read-only or unknown role → the shared `READ_ONLY_AFFORDANCE_BADGE_TONE`
  (`ReadOnlyActionBadge.tsx`) with a leading `Lock` icon: `border-amber-500/40 bg-amber-500/10
  text-amber-300`. The tone is authored for the console's dark `:root` directly (no `dark:`
  variant) — a bare `text-amber-700` renders dark-on-dark at ~3.4:1, below WCAG AA, whereas
  `text-amber-300` reads at ~11:1 on the near-black background.
- write-capable role → neutral `Badge` (no icon)

The label collapses to icon-only below the `sm` breakpoint (an inner `hidden sm:inline` span); the
badge always carries a native `title` and `aria-label` spelling out the constraint (e.g. *"Rol actual:
Viewer · solo lectura. Puedes consultar, pero las acciones de creación, edición y eliminación están
deshabilitadas."*). The avatar dropdown's own role list is unchanged — it still shows the raw
`platformRoles` tokens; only the new always-visible chrome badge is humanized.

## Permission-aware affordances

The rule applied consistently: **a page-level "create" CTA the role can never use is HIDDEN** (not
merely disabled) and replaced by a small amber "read-only" indicator carrying the reason in its
`title`; **inline row actions beside otherwise-readable data are disabled** with the same reason.

| Page | Action | Gated on |
| --- | --- | --- |
| `ConsoleFlowsPage` | "Flujo nuevo" button + name input | `workspace.write` |
| `ConsoleMembersPage` | "Invitar usuario" wizard trigger + "Crear usuario" direct-create toggle | `tenant.members.manage` |
| `ConsoleWorkspacesPage` | "Nueva área de trabajo" button | `tenant.workspaces.create` |
| `ConsoleServiceAccountsPage` | Create / Revelar / Rotar / Revocar | `workspace.write` (extends the page's existing `writesBlocked` disable-with-reason mechanism, previously only for a non-active tenant) |

`ConsoleWorkspacesPage` has no read content of its own beyond the create wizard (workspace inventory
lives at `/console/workspaces/:workspaceId`), so hiding its CTA for a read-only role leaves an honest
empty page rather than a wizard that blocks late with its trigger still enabled.

### Members invite flow

`ConsoleMembersPage` exposes two member-management paths to principals that satisfy
`tenant.members.manage`:

- **"Invitar usuario"** opens `InviteUserWizard`, which delegates `invite_member` to the same
  permission source and submits `POST /v1/tenants/{tenantId}/invitations` with
  email/role/message plus the active `workspaceId`. This flow does not ask the owner to set a
  password, and the deployed control-plane handler persists a masked-email/hash invitation record
  rather than the raw email address.
- **"Crear usuario"** keeps the direct Keycloak user-create panel for administrators that need to
  provision a password-backed user immediately.

For read-only roles (`tenant_viewer`, `tenant_developer`) both actions are hidden and the same
read-only indicator is shown.

### Not yet covered (follow-up)

The data-plane editors (`postgres/data`, `mongo/data`, `events/data`, `realtime/changes`), Kafka, and
the Postgres/Mongo schema browsers mix real read value with write affordances; auditing each page's
exact read/write split and applying the same hide/disable pattern is a recommended follow-up rather
than a blanket change that risks hiding genuinely useful read surfaces.

## Graceful permission-denied state

`apps/web-console/src/components/console/PermissionDeniedNotice.tsx` wraps the existing
`ConsolePageState kind="blocked"` primitive (already `role="alert"`) with role-aware copy from
`denyReason()`. It replaces raw backend `403` error text as a **defense-in-depth fallback** — reached
only when the CTA above was somehow still enabled (e.g. a stale-session race after a mid-session role
change) — in:

- `ConsoleFlowsPage`'s flow-draft create handler
- `ConsoleMembersPage::CreateUserPanel`'s user-create handler

Wizard permission pre-gates (`CreateTenantWizard`, `CreateWorkspaceWizard`, `InviteUserWizard`,
`ProvisionDatabaseWizard`, `PublishFunctionWizard`, `CreateIamClientWizard`) already rendered
`ConsolePageState kind="blocked"` before this change; they now receive their `reason` text from
`useWizardPermissionCheck`'s delegation to `denyReason()`, so the copy is role-aware without changing
each wizard's own render code.

## Observer-first information architecture

- **Landing destination.** `LoginPage.tsx::resolvePostLoginDestination` and
  `router.tsx::ConsoleIndexRedirect` (the bare `/console` index route) send a read-only role
  (`isReadOnly` true) to `/console/observability` instead of the operator `overview` placeholder. An
  explicit deep-link intent (`consumeProtectedRouteIntent`, e.g. a bookmarked protected route) still
  wins over this default for every role.
- **Nav grouping.** `ConsoleShellLayout.tsx`'s nav items can carry a `restrictedForAction`
  `PermissionAction`. For an `isReadOnly` principal whose role is denied that action, the item's
  effective group becomes `restricted`, rendered under the heading **"Administración (requiere
  permisos)"** at the end of the sidebar instead of its normal group. This is additive to issue #741's
  nav-visibility gating — it never hides an entry from a role that CAN use it, it only changes which
  heading a read-only role sees it under. Entries currently regrouped this way: `Gestión de áreas de
  trabajo`, `DB del área de trabajo`, the `Funciones: *` family (registro / administrar / despliegue
  rápido), `Cuentas de servicio`, and `Secretos del área de trabajo`.
- **Audit tab.** `ConsoleObservabilityPage`'s "Auditoría" tab button is hidden when
  `!can('tenant.audit.read')` — true for `tenant_developer` only among the tenant-tier roles. A
  `tenant_viewer` keeps the tab (the model's one asymmetry between the two read-only roles). The
  page also withholds the `activeTenantId`/`activeWorkspaceId` it passes to `useConsoleAuditRecords`
  (passing `null`/`null` instead) when `!can('tenant.audit.read')`, so a `tenant_developer` — whose
  default landing is this page — never fires a background `GET .../audit-records` that would 403
  before the user even opens the (hidden) tab.

## Related docs

- `docs/reference/architecture/console-wizard-permission-gates.md` — the wizard-specific gate that now
  delegates here.
- `docs/reference/architecture/structural-write-role-gates.md` — the backend structural-write role
  gate; `canPerformStructuralWrites` on the console side now delegates to the same role set.
- `docs/reference/architecture/console-effective-entitlements-mapping.md` — the sidebar's existing
  nav-visibility gating (issue #741), which this change's nav grouping is additive to.
- `docs/reference/architecture/console-auth-iam-permission-gate.md` — the superadmin-only Auth/IAM
  gate (unrelated to tenant-role affordance shaping, but the same file family).
