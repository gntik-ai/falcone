# 02 — Web Console Surface (apps/web-console)

Code-only enumeration of the Falcone Web Console for the empirical E2E campaign. Derived from
`apps/web-console/src` (the source of the deployed image `localhost:30500/in-falcone-web-console`).
No README/docs narrative used. Path evidence is `apps/web-console/src/…`.

Stack: React + React Router v6 (`createBrowserRouter`), Vite build, served by nginx (SPA + `/v1/*`
edge proxy). All backend calls go to the same origin under `/v1/*` (a few orphaned pages use `/api`).

---

## 1. Page route → purpose → backend API → capability → actions

Auth wrapper key: `ProtectedRoute` (`components/auth/ProtectedRoute.tsx`) gates everything under
`/console/*` on a stored session; `RequireSuperadminRoute` (in `router.tsx`) additionally requires
`platformRoles` to include `superadmin` (else redirect to `/console/my-plan`). Router source:
`apps/web-console/src/router.tsx`.

### Public / pre-auth routes

| Route | Page source | Purpose | Backend API calls | Capability | Actions |
|---|---|---|---|---|---|
| `/` | `WelcomePage.tsx` | Landing/marketing entry; links to login/signup | none | — | navigate |
| `/login` | `LoginPage.tsx` | Console login (username/password) | `GET /v1/auth/signups/policy`; `POST /v1/auth/login-sessions`; `GET /v1/auth/status-views/{id}` | cap-auth-console | submit login, branch to signup/pending |
| `/signup` | `SignupPage.tsx` | Public self-registration | `GET /v1/auth/signups/policy`; `POST /v1/auth/signups` | cap-auth-console | create signup request |
| `/signup/pending-activation` | `PendingActivationPage.tsx` | Post-signup waiting state | `GET /v1/auth/status-views/{id}` | cap-auth-console | view status |
| `*` (unmatched) | `NotFoundPage.tsx` | 404 | none | — | — |

### Console shell (under `/console`, inside `ConsoleShellLayout`)

The shell header has a **tenant selector** and **workspace selector** that drive the active context
(`lib/console-context.tsx`): `GET /v1/tenants?…` and `GET /v1/workspaces?…`. Avatar menu → Profile,
Settings, Logout (`DELETE /v1/auth/login-sessions/{sessionId}`). An `ActiveOperationsIndicator`
polls async operations via `POST /v1/async-operation-query` (`lib/console-operations.ts`).

| Route | Page source | Purpose | Backend API calls | Capability | Actions |
|---|---|---|---|---|---|
| `/console/overview` | `ConsolePlaceholderPage` | Static overview placeholder | none | — | — |
| `/console/tenants` | `ConsoleTenantsPage.tsx` (+ `CreateTenantWizard`) | Tenant admin list + create | `GET /v1/tenants`; `POST /v1/tenants` | cap-tenant-lifecycle, cap-tenant-provisioning | create tenant |
| `/console/workspaces` | `ConsoleWorkspacesPage.tsx` (+ `CreateWorkspaceWizard`) | Workspaces of active tenant + create | `GET /v1/workspaces`; `POST /v1/tenants/{tenantId}/workspaces` | cap-workspace-lifecycle | create workspace |
| `/console/workspaces/:workspaceId` | `ConsoleWorkspaceDashboardPage.tsx` | Per-workspace dashboard | `GET /v1/workspaces/{id}/consumption`, capability catalog | cap-workspace-lifecycle, cap-quotas-plans | view |
| `/console/database` | `ConsoleWorkspaceDatabasePage.tsx` (+ `ProvisionDatabaseWizard`) | Provision/rotate the workspace's dedicated Postgres DB | `GET/POST /v1/workspaces/{id}/database`; `POST /v1/workspaces/{id}/database/credential-rotations`; wizard `POST /v1/workspaces/{id}/databases` | cap-postgres-data-api, cap-tenant-provisioning | provision, rotate credentials |
| `/console/functions-registry` | `ConsoleFunctionRegistryPage.tsx` (+ `PublishFunctionWizard`) | Register functions of active workspace | `GET/POST /v1/workspaces/{id}/functions` | cap-functions | register/publish function |
| `/console/iam-access` ⭐superadmin | `ConsoleIamAccessPage.tsx` | Assign realm roles / group membership | `GET /v1/iam/realms/{realmId}/roles`, `/users`; `PUT /v1/iam/realms/{realm}/users/{userId}` (role assign) | cap-iam-admin | assign roles, manage membership |
| `/console/members` | `ConsoleMembersPage.tsx` (+ `InviteUserWizard`) | Tenant realm members/roles | `GET /v1/iam/realms/{realmId}/users`, `/roles`; `POST /v1/tenants/{tenantId}/users`; wizard `POST /v1/workspaces/{id}/invitations` | cap-iam-admin | invite user, create user |
| `/console/plans` ⭐superadmin | `ConsolePlanCatalogPage.tsx` | Plan catalog | `GET /v1/plans` | cap-quotas-plans | view, → new/detail |
| `/console/plans/new` ⭐superadmin | `ConsolePlanCreatePage.tsx` | Create plan | `POST /v1/plans` | cap-quotas-plans | create plan |
| `/console/plans/:planId` ⭐superadmin | `ConsolePlanDetailPage.tsx` | Plan detail / limits / lifecycle | `GET/PATCH /v1/plans/{id}`; `…/lifecycle`; `…/limits`, `…/limits/{dim}`; `GET /v1/quota-dimensions` | cap-quotas-plans | edit limits, change lifecycle |
| `/console/tenants/:tenantId/plan` ⭐superadmin | `ConsoleTenantPlanPage.tsx` | Assign plan to a tenant | `GET/PUT /v1/tenants/{tenantId}/plan`; `…/history`, `…/history-impact` | cap-quotas-plans | assign/change tenant plan |
| `/console/my-plan` | `ConsoleTenantPlanOverviewPage.tsx` | Current tenant's plan & entitlements | `GET /v1/tenant/plan`, `…/limits`, `…/effective-entitlements`, `…/consumption`, `/v1/tenant/effective-capabilities` | cap-quotas-plans | view |
| `/console/my-plan/allocation` | `ConsoleTenantAllocationSummaryPage.tsx` | Plan allocation across workspaces | `GET /v1/tenant/plan/allocation-summary` | cap-quotas-plans | view |
| `/console/auth` | `ConsoleAuthPage.tsx` (+ `CreateIamClientWizard`) | IAM scopes/clients/providers + external applications + social/federation providers | `GET /v1/iam/realms/{realmId}/scopes`,`/clients`,`/roles`,`/users`; `GET/POST/PATCH/DELETE /v1/workspaces/{id}/applications[/{appId}]`; `…/federation/providers[/{providerId}]`; wizard `POST /v1/workspaces/{id}/iam/clients` | cap-auth-console, cap-iam-admin, cap-external-apps-service-accounts | create client, CRUD external apps, CRUD federation/social providers |
| `/console/postgres` | `ConsolePostgresPage.tsx` | Postgres schema browser (DBs, schemas, tables, columns, indexes, views, matviews, RLS/security, DDL preview) | `GET /v1/postgres/databases…/schemas…/tables…/columns,indexes,policies,security,views,materialized-views`; `POST/DELETE` for create/drop (DDL) | cap-postgres-data-api | create/drop schema/table/index, view DDL, inspect RLS |
| `/console/postgres/data` | `ConsolePostgresDataPage.tsx` (uses `services/postgresApi.ts`) | Row CRUD via data executor + anon/service API keys | `GET/POST/PATCH/DELETE /v1/postgres/workspaces/{id}/data/{db}/schemas/{s}/tables/{t}`; `GET/POST /v1/workspaces/{id}/api-keys` (apikey header) | cap-postgres-data-api, cap-external-apps-service-accounts | CRUD rows, issue/list API keys |
| `/console/mongo` | `ConsoleMongoPage.tsx` | Mongo/FerretDB browser (DBs, collections, indexes, views, documents) | `GET /v1/mongo/databases…/collections…/indexes,views`; `POST/DELETE` for create/drop | cap-mongo-data-api | create/drop DB/collection/index, inspect |
| `/console/mongo/data` | `ConsoleMongoDataPage.tsx` (uses `services/mongoApi.ts`) | Document CRUD via data executor | `GET/POST/PATCH/DELETE /v1/mongo/workspaces/{id}/data/{db}/collections/{c}/documents` (apikey header) | cap-mongo-data-api | CRUD documents |
| `/console/kafka` | `ConsoleKafkaPage.tsx` | Kafka topics, ACLs, lag metrics, bridges, publish/stream | `GET /v1/events/workspaces/{id}/inventory`; `GET/DELETE /v1/events/topics/{id}`, `…/access`, `…/metadata`, `…/stream`; `POST …/publish`; `…/workspaces/{id}/bridges/{bridgeId}` | cap-events | create/delete topic, manage ACL, publish, view lag/bridges |
| `/console/events/data` | `ConsoleEventsDataPage.tsx` (uses `services/eventsApi.ts`) | Topics, publish & consume over executor | `GET/POST /v1/events/workspaces/{id}/topics`; publish/consume | cap-events | create topic, publish, consume |
| `/console/functions` | `ConsoleFunctionsPage.tsx` | Serverless functions admin: list, versions, activations, logs, result, invoke, rollback | `GET /v1/functions/workspaces/{id}/inventory`; `GET/PATCH/DELETE /v1/functions/actions/{id}`; `…/versions`, `…/activations[/{actId}][/logs|/result]`; `POST …/invocations`, `…/rollback` | cap-functions | invoke, rollback, inspect activations/logs |
| `/console/functions/data` | `ConsoleFunctionsDataPage.tsx` (uses `services/functionsApi.ts`) | Deploy & invoke functions over executor | `GET/POST /v1/functions/workspaces/{id}/actions`; invoke; activations | cap-functions | deploy, invoke |
| `/console/realtime/changes` | `ConsoleRealtimeChangesPage.tsx` (uses `services/realtimeApi.ts`) | SSE change-stream of a Mongo collection / Postgres table with anon key | `EventSource GET /v1/realtime/workspaces/{id}/data/{db}/collections/{c}/changes?apikey=` (or `…/schemas/{s}/tables/{t}/changes`) | cap-realtime | subscribe/unsubscribe stream |
| `/console/flows` | `ConsoleFlowsPage.tsx` (uses `services/flowsApi.ts`) | Workflow (flow) list | `GET /v1/flows/workspaces/{id}/flows`; `POST` create draft | cap-functions (workflows) | create flow draft |
| `/console/flows/:flowId` | `ConsoleFlowDesignerPage.tsx` | Visual flow designer (xyflow), YAML editor, validate/publish | `GET/PATCH /v1/flows/workspaces/{id}/flows/{flowId}`; `…/validate`, `…/publish`; `GET /v1/flows/workspaces/{id}/task-types` | cap-functions | edit/validate/publish flow |
| `/console/flows/:flowId/runs` | `ConsoleFlowHistoryPage.tsx` (uses `flowsMonitoringApi.ts`) | Flow run history | `GET /v1/flows/workspaces/{id}/flows/{flowId}` (runs) | cap-functions | view runs |
| `/console/flows/:flowId/runs/:executionId` | `ConsoleFlowRunPage.tsx` | Single flow-run view | run-scoped flows monitoring API | cap-functions | view run detail |
| `/console/storage` | `ConsoleStoragePage.tsx` | Object storage: buckets, objects, usage, metadata | `GET /v1/storage/buckets`; `…/buckets/{id}/objects`, `…/objects/{key}/metadata`; `GET /v1/storage/workspaces/{id}/usage` | cap-storage | browse buckets/objects, view metadata/usage |
| `/console/observability` | `ConsoleObservabilityPage.tsx` (uses `lib/console-metrics.ts`) | Metrics & operational signals | `GET /v1/metrics/tenants/{id}` / `…/workspaces/{id}` (+ `/overview`) | cap-metrics, cap-audit | view metrics |
| `/console/service-accounts` | `ConsoleServiceAccountsPage.tsx` (uses `lib/console-service-accounts.ts`) | Service accounts + programmatic credentials | `GET/POST/DELETE /v1/workspaces/{id}/service-accounts[/{id}]`; `…/credential-issuance`, `…/credential-revocations`, `…/credential-rotations` | cap-external-apps-service-accounts | create/delete SA, issue/rotate/revoke credentials |
| `/console/quotas` | `ConsoleQuotasPage.tsx` (uses `lib/console-quotas.ts`) | Quota posture per tenant/workspace | `GET /v1/metrics/tenants/{id}/quotas`,`/overview`; `…/workspaces/{id}/quotas`,`/overview` | cap-quotas-plans, cap-metrics | view quota usage |
| `/console/operations` | `ConsoleOperationsPage.tsx` | Async operation tracking | `POST /v1/async-operation-query` | cap-tenant-provisioning, cap-audit | list/track operations |
| `/console/operations/:operationId` | `ConsoleOperationDetailPage.tsx` | Single async operation detail + logs | `POST /v1/async-operation-query` | cap-tenant-provisioning, cap-audit | view operation |
| `/console/mcp/servers/:mcpServerId` | `ConsoleMcpServerDetailPage.tsx` (uses `lib/mcp/mcp-api.ts`) | MCP server detail, connect panel, tool-call playground | `GET /v1/mcp/servers/{id}`; `POST /v1/mcp/servers/{id}/playground/tool-calls` | cap-functions (MCP hosting) | connect, run tool calls |
| `/console/workspaces/:workspaceId/realtime` | `ConsoleRealtimePage.tsx` | Realtime subscriptions admin for a workspace | `GET /v1/workspaces/{id}/realtime` | cap-realtime | view/manage subscriptions |
| `/console/workspaces/:workspaceId/docs` | `ConsoleDocsPage.tsx` (uses `console-openapi-sdk.ts` + `console-workspace-docs.ts`) | Workspace OpenAPI spec, SDK generation, doc notes | `GET /v1/workspaces/{id}/openapi`; `POST /v1/workspaces/{id}/sdks/generate`, `GET …/sdks/{lang}/status`; `GET/POST/PUT/DELETE /v1/workspaces/{id}/docs[/notes/{noteId}]` | cap-workspace-docs, cap-workspace-api-surface | download spec, generate SDK, CRUD notes |
| `/console/secrets` | `ConsoleSecretsPage.tsx` | Platform secrets list + consumer status/history | `GET /v1/platform/secrets/{domain}/{name}/consumer-status`, `…/history` | cap-secrets | view, → rotate |
| `/console/secrets/:encodedSecretPath/rotate` | `ConsoleSecretRotationPage.tsx` (uses `actions/secretRotationActions.ts`) | Rotate / revoke a secret version | `POST /v1/platform/secrets/{domain}/{name}/rotate`; `POST …/versions/{v}/revoke` | cap-secrets | rotate, revoke version |
| `/console/profile` | `ConsolePlaceholderPage` | Placeholder | none | — | — |
| `/console/settings` | `ConsolePlaceholderPage` | Placeholder | none | — | — |

⭐ = `RequireSuperadminRoute` (superadmin-only).

**Routed page count:** 5 public/pre-auth + 2 placeholders + 39 functional `/console/*` routes
(incl. `index` redirect and `*` catch-all not counted) ≈ **44 distinct route patterns**, backed by
**~46 page components** wired in the router.

### Orphaned pages (exist in source but NOT wired into `router.tsx`)

These compiled page components have NO route — **unreachable from the SPA** (no nav entry, no
`<Route>`), so they cannot be exercised end-to-end through the deployed console even though their
backend endpoints exist:

| Page source | Intended purpose | Backend API it would call | Capability |
|---|---|---|---|
| `ConsoleCapabilityCatalogPage.tsx` | Effective capability catalog | `GET /v1/workspaces/{id}/capability-catalog`, `/v1/tenant/effective-capabilities` | cap-quotas-plans |
| `ConsoleApiReferencePage.tsx` | API reference (`/v1/schemas`, `/v1/openapi`) | `GET /v1/schemas` | cap-workspace-api-surface |
| `ConsolePrivilegeDomainPage.tsx` | Per-member privilege domains | `GET/PUT/DELETE /api/workspaces/{id}/members[/{memberId}]/privilege-domains` | cap-iam-admin |
| `ConsolePrivilegeDomainAuditPage.tsx` | Privilege-domain audit trail | same family | cap-audit, cap-iam-admin |
| `ConsoleScopeEnforcementPage.tsx` | Tenant scope-enforcement view | scope-enforcement API (`lib/console-scope-enforcement.ts`) | cap-tenant-isolation |
| `ConsoleBackupScopePage.tsx` | Backup scope matrix | `GET /v1/admin/backup/scope?profile=…` | cap-backup-restore |
| `ConsoleTenantConfigExportPage.tsx` | Export tenant config | `GET /api/v1/admin/tenants/{id}/config/export/domains`; `POST …/config/export` | cap-tenant-lifecycle |
| `ConsoleTenantConfigPreflightPage.tsx` | Reprovision preflight | `…/config/reprovision/preflight`, `…/reprovision/identifier-map`, `/v1/admin/config/format-versions` | cap-tenant-provisioning |
| `ConsoleTenantConfigReprovisionPage.tsx` | Tenant reprovision | `POST /admin/tenants/{id}/config/reprovision` / `/v1/admin/tenants/{id}/config/reprovision` | cap-tenant-provisioning |

> Backup/restore hooks (`hooks/useTriggerBackup.ts`, `useSnapshots.ts`, `useTriggerRestore.ts`,
> `useAbortRestore.ts`, `useConfirmRestore.ts`) and `services/backupOperationsApi.ts` (base `/api`)
> also exist but are only consumed by the orphaned `ConsoleBackupScopePage` — backup/restore has **no
> reachable console UI**.

---

## 2. Login / auth flow (NOT browser-OIDC redirect)

The console does **not** perform a Keycloak OIDC authorization-code redirect. It uses a
**password-grant-over-REST** flow against the control-plane's normalized `/v1/auth/*` family, which
brokers Keycloak server-side:

- **Config** (`lib/console-config.ts`, env-overridable `VITE_*`, with defaults):
  - realm = **`in-falcone-platform`** (`VITE_CONSOLE_AUTH_REALM`)
  - OIDC client id = **`in-falcone-console`** (`VITE_CONSOLE_AUTH_CLIENT_ID`)
  - login/signup/pending paths default to `/login`, `/signup`, `/signup/pending-activation`.
- **Login** (`LoginPage.tsx` → `lib/console-auth.ts`): `POST /v1/auth/login-sessions` with
  `{username, password, rememberMe}` → returns `ConsoleLoginSession` with a `tokenSet`
  (`accessToken`/`refreshToken`, Bearer). Session is stored via `persistConsoleShellSession`
  (`lib/console-session.ts`, localStorage/sessionStorage). On success → navigate to
  `resolvePostLoginDestination()` (saved intent or `/console/overview`).
- **Status branching**: 409 errors map to status-views (`pending_activation`, `account_suspended`,
  `credentials_expired`) via `inferStatusViewFromError` + `GET /v1/auth/status-views/{id}`.
- **Signup**: `GET /v1/auth/signups/policy` gates the signup CTA; `POST /v1/auth/signups`.
- **Authenticated calls**: `requestConsoleSessionJson` (`console-session.ts`) attaches
  `Authorization: Bearer <accessToken>`, and on `401` runs a single refresh
  (`POST /v1/auth/login-sessions/{sessionId}/refresh`) then retries.
- **Logout**: `DELETE /v1/auth/login-sessions/{sessionId}` (best-effort) + local session clear.
- **Route guard**: `ProtectedRoute` reads the stored shell session; `RequireSuperadminRoute` checks
  `principal.platformRoles.includes('superadmin')`.

So the OIDC client `in-falcone-console` on realm `in-falcone-platform` is referenced by the console,
but token issuance is mediated by the backend `/v1/auth/*` endpoints (no front-channel redirect URI
handling in the SPA).

---

## 3. Gateway / API base-URL resolution

- **Same-origin relative URLs.** All API clients call **relative** paths (`/v1/…`) via
  `fetch`/`requestJson` (`lib/http.ts`) and `requestConsoleSessionJson` (`lib/console-session.ts`).
  There is **no** `VITE_API_BASE_URL`/runtime-config base for the main `/v1/*` surface — the browser
  hits the console's own origin.
- **nginx edge proxy** (`apps/web-console/nginx.conf`): a `location /v1/ { proxy_pass
  http://${GATEWAY_UPSTREAM}; }` block forwards every `/v1/*` request to the gateway (APISIX,
  default `falcone-apisix:9080`, Helm-overridable via `GATEWAY_UPSTREAM` envsubst). APISIX validates
  the JWT and forwards to the control-plane. The SPA catch-all (`try_files … /index.html`) sits below
  the `/v1/` location so API calls are never rewritten to HTML.
- **Standard headers** added by `lib/http.ts`: `X-API-Version: 2026-03-26`, `X-Correlation-Id`, and
  `Idempotency-Key` for non-GET/idempotent requests.
- **Executor data-plane** (`services/postgresApi.ts`, `mongoApi.ts`): anon/service API keys are sent
  via the **`apikey` header** (not `Authorization`); realtime SSE passes the key as
  `?apikey=` (`services/realtimeApi.ts`) because `EventSource` cannot set headers.
- **Exception — orphaned config/backup pages only:** `api/config*.ts` and
  `services/backupOperationsApi.ts` default their base to **`/api`** (overridable by
  `CONFIG_EXPORT_API_URL`, a Node `process.env` — not a Vite var, so effectively `/api` in the
  browser). These pages are not routed, so this base is dead in the deployed SPA.

---

## 4. Console coverage gaps (capabilities/domains with NO reachable console page)

Reachable from the console (has a wired route + nav/deep-link):
cap-auth-console, cap-iam-admin, cap-external-apps-service-accounts, cap-tenant-lifecycle,
cap-tenant-provisioning, cap-workspace-lifecycle, cap-workspace-api-surface, cap-workspace-docs,
cap-postgres-data-api, cap-mongo-data-api, cap-storage, cap-realtime, cap-events, cap-functions
(incl. workflows + MCP), cap-quotas-plans, cap-metrics, cap-secrets.

**No reachable console page (gaps):**

- **cap-backup-restore** — only the orphaned `ConsoleBackupScopePage` + backup hooks; no route, no nav.
- **cap-tenant-isolation** — only the orphaned `ConsoleScopeEnforcementPage`; no route.
- **cap-pg-cdc / cap-mongo-cdc** — CDC plumbing surfaces only indirectly via the realtime changes
  page (a consumer of change streams); no dedicated CDC management UI.
- **cap-webhooks** — no console page or API client found.
- **cap-scheduling (cron)** — no dedicated console page (cron is only implicit inside flows/workflows).
- **cap-token-validation** — backend-internal; no UI (expected).
- **cap-context-propagation / cap-gateway** — infrastructure capabilities; no UI (expected).
- **cap-audit** — partial only: surfaced via Observability metrics; the dedicated audit/privilege
  audit views (`ConsolePrivilegeDomainAuditPage`) are **orphaned/unrouted**.
- **Tenant config export / reprovision** (part of cap-tenant-lifecycle/provisioning) — pages exist
  (`ConsoleTenantConfig*Page`) but are **orphaned/unrouted**.

**Environments admin gap:** there is **no environment-management page**. Environment is only a
read-only badge on the workspace context (`ConsoleShellLayout` shows `activeWorkspace.environment`)
and an optional `requestedEnvironment` field on signup; first-class environment CRUD is not exposed.

> Net: of the audited capability domains, the console UI reachably covers ~17; **backup-restore,
> webhooks, scheduling, scope-enforcement/isolation admin, audit, environments, and tenant
> config-export/reprovision are not reachable** (5 of those have built-but-orphaned pages).
