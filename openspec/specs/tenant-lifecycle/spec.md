# tenant-lifecycle

## Purpose

This capability owns the tenant as the root business boundary in In Falcone: tenant CRUD with explicit lifecycle states, tenant-scoped memberships, invitations, ownership transfers, soft-delete and purge, suspension and reactivation, the tenant governance dashboard, the tenant resource inventory, and the tenant-scoped storage context. It also owns the operational tenant-configuration surfaces — export, pre-flight conflict check, and reprovision — that move a tenant's functional configuration between environments under audit. The capability is anchored in the canonical core-domain and governance baselines (ADR 0006 / 0007) so every downstream module reuses the same identifiers, lifecycle transitions, and effective-capability resolution. The provisioning saga that bootstraps a new tenant — IAM contexts, plan assignment, deployment-profile bindings, default workspace, audit baselines — lives in `services/provisioning-orchestrator` and is owned by this capability.

## Surfaces

- **Public REST endpoints**:
  - `/v1/tenants` (`apps/control-plane/openapi/families/tenants.openapi.json`) — `GET /v1/tenants`, `POST /v1/tenants`, `GET /v1/tenants/{tenantId}`, `PUT /v1/tenants/{tenantId}`, `DELETE /v1/tenants/{tenantId}` (logical delete), `GET /v1/tenants/{tenantId}/dashboard`, `GET /v1/tenants/{tenantId}/effective-capabilities`, `POST /v1/tenants/{tenantId}/exports`, `POST /v1/tenants/{tenantId}/iam-access`, `GET /v1/tenants/{tenantId}/inventory`, invitations (`POST /invitations`, `GET /invitations/{invitationId}`, `POST /invitations/{invitationId}/acceptance`, `POST /invitations/{invitationId}/revocation`), memberships (`POST /memberships`, `GET /memberships/{tenantMembershipId}`), ownership transfers (`POST /ownership-transfers`, `GET /ownership-transfers/{ownershipTransferId}`, `POST /ownership-transfers/{ownershipTransferId}/acceptance`), `GET /v1/tenants/{tenantId}/permission-recalculations/{permissionRecalculationId}`, `POST /v1/tenants/{tenantId}/purge`, `POST /v1/tenants/{tenantId}/reactivation`, `GET /v1/tenants/{tenantId}/storage-context`, `POST /v1/tenants/{tenantId}/storage-context/credential-rotations`, `GET /v1/tenants/{tenantId}/workflow-jobs/{jobRef}`.
  - _(today, but not in any `/v1/*` family)_ — the tenant-config admin surfaces consumed by the three `ConsoleTenantConfig*` pages: `GET /v1/admin/tenants/{tenantId}/config/export/domains`, `POST /v1/admin/tenants/{tenantId}/config/export`, `POST /v1/admin/tenants/{tenantId}/config/reprovision/preflight`, `POST /v1/admin/tenants/{tenantId}/config/reprovision/identifier-map`, `POST /v1/admin/tenants/{tenantId}/config/reprovision`. These are not registered in `tenants.openapi.json`. See **Q-TEN-01**.
- **Frontend pages**:
  - `ConsoleTenantsPage` → `/console/tenants`
  - `ConsoleMembersPage` → `/console/members`
  - `ConsoleTenantConfigExportPage` → _(missing route)_ — embedded sub-view receiving `tenantId` via props; see **Q-TEN-02**.
  - `ConsoleTenantConfigPreflightPage` → _(missing route)_ — embedded sub-view receiving `tenantId`, `userRole` via props; gated to `superadmin` and `sre` only; see **Q-TEN-02**.
  - `ConsoleTenantConfigReprovisionPage` → _(missing route)_ — embedded sub-view receiving `tenantId`, `userRole` via props; gated to `superadmin` and `sre` only; see **Q-TEN-02**.
- **Internal contracts**:
  - `services/internal-contracts/src/domain-model.json` — canonical entity model, lifecycle states, transitions, lifecycle event vocabulary, effective-capability-resolution shape.
  - `services/internal-contracts/src/saga-contract.json` — saga envelope used by the provisioning orchestrator.
  - `services/internal-contracts/src/async-operation-state-changed.json`, `services/internal-contracts/src/async-operation-query-response.json` — async-job status surfaces consumed by the `workflow-jobs/{jobRef}` route.
  - `services/internal-contracts/src/console-workflow-invocation.json`, `services/internal-contracts/src/console-workflow-job-status.json`, `services/internal-contracts/src/console-workflow-audit-policy.json` — workflow invocation contracts emitted by the orchestrator.
  - `services/internal-contracts/src/intervention-notification-event.json`, `services/internal-contracts/src/manual-intervention-required-event.json`, `services/internal-contracts/src/operation-cancel-event.json`, `services/internal-contracts/src/operation-recovery-event.json`, `services/internal-contracts/src/operation-retry-event.json`, `services/internal-contracts/src/operation-timeout-event.json`, `services/internal-contracts/src/retry-override-event.json`, `services/internal-contracts/src/idempotency-dedup-event.json`, `services/internal-contracts/src/failure-classified-event.json` — long-running provisioning lifecycle envelopes.
- **Kafka topics emitted**:
  - Tenant lifecycle events declared in `services/internal-contracts/src/domain-model.json`: `tenant.created`, `tenant.activated`, `tenant.suspended`, `tenant.soft_deleted`; `tenant_membership.{created,activated,suspended,soft_deleted}`; `invitation.{created,activated,suspended,soft_deleted}`. See **Q-TEN-04** for emission ownership.
  - Tenant-config admin events emitted by `services/provisioning-orchestrator`: `console.config.export.completed` (`config-export-events.mjs`), `console.config.reprovision.completed`, `console.config.reprovision.identifier_map.generated` (`config-reprovision-events.mjs`), `console.config.preflight.completed` (`config-preflight-events.mjs`).
  - Async-operation lifecycle events (`operation-cancel-event.json`, `operation-recovery-event.json`, `operation-retry-event.json`, `operation-timeout-event.json`, etc.) emitted by saga steps.
- **Kafka topics consumed**:
  - _None directly._ The orchestrator consumes adapter-call results via internal queues, not via Kafka topics owned by other capabilities.
- **PostgreSQL tables owned**:
  - Saga and async-operation state: `saga_instances`, `saga_steps`, `async_operations`, `async_operation_log_entries` (created by `services/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql`, `073-async-operation-tables.sql`, `074-async-operation-log-entries.sql`).
  - Idempotency, retry, timeout/cancel/recovery: `idempotency-retry-tables`, `timeout-cancel-recovery`, `retry-semantics-intervention` (created by `075-idempotency-retry-tables.sql`, `076-timeout-cancel-recovery.sql`, `078-retry-semantics-intervention.sql`).
  - Tenant-config audit: `config_export_audit_log` (`115-functional-config-export.sql`), `tenant_config_reprovision_locks`, `config_reprovision_audit_log` (`117-tenant-config-reprovision.sql`), `config_preflight_audit_log` (`118-config-preflight.sql`).
  - Tenant rotation policy: `tenant_rotation_policy` (referenced by `services/provisioning-orchestrator/src/repositories/tenant-rotation-policy-repo.mjs`).

## Behaviour

### REQ-TEN-01 — Tenant CRUD with explicit lifecycle states

**Description.** A tenant is a canonical entity (per ADR 0006) with a stable identifier and a lifecycle state machine. Every state transition is auditable; soft-delete is logical and preserves the identifier; final removal happens only through `purge` after retention and confirmation checks.

**Acceptance criteria.**

- `POST /v1/tenants` accepts a canonical tenant write request with governance labels, quotas, and lifecycle controls and returns the created tenant in `draft` or `provisioning` state.
- `PUT /v1/tenants/{tenantId}` updates lifecycle, quota, label, and retention governance settings; downstream descendant entities cannot remain `active` once the tenant is `suspended` or `soft_deleted` (per `domain-model.json`).
- `DELETE /v1/tenants/{tenantId}` performs a logical delete that preserves audit trails and retention; subsequent `POST /v1/tenants/{tenantId}/purge` permanently removes the tenant only after retention and elevated-confirmation checks.
- The shared lifecycle vocabulary is exactly `draft`, `provisioning`, `active`, `suspended`, `soft_deleted` and the transitions follow `getBusinessStateMachine('tenant_lifecycle')`.

**Trace.**
`apps/control-plane/openapi/families/tenants.openapi.json`, `apps/control-plane/src/tenant-management.mjs`, `services/internal-contracts/src/domain-model.json`, `docs/adr/0006-core-domain-entity-model.md`, `docs/tasks/us-ten-04.md`, `docs/tasks/us-dom-01.md`.

### REQ-TEN-02 — Tenant memberships and tenant-scoped IAM access toggle

**Description.** A platform user becomes a tenant participant only through an explicit `tenant_membership` record. Suspending or reactivating tenant-managed IAM access is a single audited operation that propagates to every user and service-account inside the tenant realm.

**Acceptance criteria.**

- `POST /v1/tenants/{tenantId}/memberships` creates a membership record with explicit role and scope; revocation goes through `soft_delete` rather than physical delete (per ADR 0007 governance rules).
- `POST /v1/tenants/{tenantId}/iam-access` accepts a single `suspend` or `reactivate` action; on suspend, all tenant-managed users and service accounts lose IAM access until reactivation completes.
- `GET /v1/tenants/{tenantId}/permission-recalculations/{permissionRecalculationId}` returns the in-progress or final state of a tenant-scoped effective-permission recalculation triggered by membership or IAM-access changes.
- Workspace memberships cannot widen tenant authority and remain tenant-safe (per ADR 0007).

**Trace.**
`apps/control-plane/openapi/families/tenants.openapi.json`, `services/internal-contracts/src/domain-model.json`, `docs/adr/0007-membership-plan-governance.md`, `docs/tasks/us-ten-04.md`, `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`.

### REQ-TEN-03 — Invitations and ownership transfers

**Description.** Onboarding into a tenant happens through invitation records with explicit acceptance / revocation; tenant ownership is reassigned through a two-step transfer that requires acceptance by the designated owner before it expires.

**Acceptance criteria.**

- `POST /v1/tenants/{tenantId}/invitations` creates an invitation that stores masked or hashed recipient identity material only; raw secrets are not persisted in the canonical domain (ADR 0007).
- `POST /v1/tenants/{tenantId}/invitations/{invitationId}/acceptance` mints the corresponding membership record only when the invitation is still pending; revoked or expired invitations cannot mint memberships.
- `POST /v1/tenants/{tenantId}/ownership-transfers` initiates a transfer that requires `POST /ownership-transfers/{id}/acceptance` from the target owner; transfers expire if not accepted.
- `POST /v1/tenants/{tenantId}/invitations/{invitationId}/revocation` invalidates a pending invitation before acceptance.

**Trace.**
`apps/control-plane/openapi/families/tenants.openapi.json`, `services/internal-contracts/src/domain-model.json`, `docs/adr/0007-membership-plan-governance.md`, `docs/tasks/us-ten-04.md`.

### REQ-TEN-04 — Tenant governance dashboard, inventory, and effective capabilities

**Description.** Operators inspect a tenant through three read-only surfaces that all derive from the same canonical model: a governance dashboard, a resource inventory, and an effective-capability projection.

**Acceptance criteria.**

- `GET /v1/tenants/{tenantId}/dashboard` returns quotas, governance labels, provisioning state, and the set of allowed actions that the calling principal may perform on the tenant.
- `GET /v1/tenants/{tenantId}/inventory` returns one snapshot covering workspaces, external applications, service accounts, and managed resources for the tenant.
- `GET /v1/tenants/{tenantId}/effective-capabilities` returns the intersection of plan entitlements, quota policy limits, deployment-profile topology support, and provider capability availability (per ADR 0007 §"Effective capability resolution"). A capability is enabled only when all four layers agree.
- The dashboard surface is computed by `summarizeTenantGovernanceDashboard` from `services/internal-contracts` (no per-route side effects).

**Trace.**
`apps/control-plane/openapi/families/tenants.openapi.json`, `apps/control-plane/src/tenant-management.mjs`, `services/internal-contracts/src/domain-model.json`, `docs/adr/0007-membership-plan-governance.md`, `docs/tasks/us-ten-04.md`.

### REQ-TEN-05 — Tenant configuration export, pre-flight, and reprovision (admin surfaces)

**Description.** Operators move a tenant's functional configuration between environments through three admin endpoints — export, pre-flight conflict check, and reprovision — all gated to `superadmin` or `sre`. Reprovision runs are mutually exclusive per tenant (lock) and are auditable.

**Acceptance criteria.**

- `POST /v1/tenants/{tenantId}/exports` (and the admin variant `POST /v1/admin/tenants/{tenantId}/config/export`) returns a recovery-oriented functional configuration export; partial successes are reported with HTTP 207 and surface the per-domain breakdown to the console.
- `POST /v1/admin/tenants/{tenantId}/config/reprovision/preflight` analyses an artifact, classifies conflicts at risk levels `low | medium | high | critical`, and either returns a report or asks the operator to confirm an identifier map proposal before re-running.
- `POST /v1/admin/tenants/{tenantId}/config/reprovision` honours `dry_run`, refuses to run when another reprovision lock is `active` for the same tenant, and writes one audit row per run with `result_status` ∈ {`success`, `partial`, `failed`, `blocked`, `dry_run`}.
- The console pages are gated client-side: `ConsoleTenantConfigPreflightPage` and `ConsoleTenantConfigReprovisionPage` render a forbidden message when the principal's role is not `superadmin` or `sre`.

**Trace.**
`apps/control-plane/openapi/families/tenants.openapi.json`, `services/provisioning-orchestrator/src/migrations/115-functional-config-export.sql`, `services/provisioning-orchestrator/src/migrations/117-tenant-config-reprovision.sql`, `services/provisioning-orchestrator/src/migrations/118-config-preflight.sql`, `apps/web-console/src/api/configExportApi.ts`, `apps/web-console/src/api/configPreflightApi.ts`, `apps/web-console/src/api/configReprovisionApi.ts`, `apps/web-console/src/pages/ConsoleTenantConfigExportPage.tsx`, `apps/web-console/src/pages/ConsoleTenantConfigPreflightPage.tsx`, `apps/web-console/src/pages/ConsoleTenantConfigReprovisionPage.tsx`.

### REQ-TEN-06 — Provisioning saga and async-operation tracking

**Description.** Tenant creation, suspension, reactivation, IAM-access toggle, ownership transfer, and tenant-config reprovision all run as durable sagas. Every saga step is idempotent under a stable correlation id; failures classify into compensate or resume; long-running runs surface as async operations the caller can poll or reconnect to.

**Acceptance criteria.**

- A saga run is identified by `saga_id` and a unique `idempotency_key`; replays of the same idempotency key return the previously recorded outcome rather than re-executing steps (per `075-idempotency-retry-tables.sql`).
- `async_operations.status` is one of `pending | running | completed | failed`; `GET /v1/tenants/{tenantId}/workflow-jobs/{jobRef}` returns the current status, last error summary, and correlation id.
- A saga whose terminal step fails enters `compensating` and runs declared compensation steps; a saga that cannot compensate enters `compensation-failed` and emits a `manual_intervention_required` event (per `services/internal-contracts/src/manual-intervention-required-event.json`).
- Reconnecting consumers re-read job state from `async_operations` rather than from in-memory state (per ADR 077).

**Trace.**
`services/provisioning-orchestrator/src/migrations/070-saga-state-tables.sql`, `services/provisioning-orchestrator/src/migrations/073-async-operation-tables.sql`, `services/provisioning-orchestrator/src/migrations/074-async-operation-log-entries.sql`, `services/provisioning-orchestrator/src/migrations/075-idempotency-retry-tables.sql`, `services/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql`, `services/provisioning-orchestrator/src/migrations/078-retry-semantics-intervention.sql`, `docs/adr/073-async-job-status-model.md`, `docs/adr/074-async-job-progress-ui.md`, `docs/adr/077-reconnect-job-state-reread.md`.

### REQ-TEN-07 — Tenant-scoped storage context and credential rotation

**Description.** Each tenant exposes one logical storage context that workspace-bucket bootstrap consumes; rotating the active credential reference must not recreate the namespace.

**Acceptance criteria.**

- `GET /v1/tenants/{tenantId}/storage-context` returns the tenant-scoped logical storage context (provider, namespace, active credential reference) without exposing secret material directly.
- `POST /v1/tenants/{tenantId}/storage-context/credential-rotations` rotates the active credential reference; the namespace identifier must remain stable across rotations.
- The rotation request is audited as a long-running operation surfaced through `GET /v1/tenants/{tenantId}/workflow-jobs/{jobRef}`.
- The actual secret material lives behind External Secrets Operator + Vault (`secret-management`); this capability never stores raw secrets.

**Trace.**
`apps/control-plane/openapi/families/tenants.openapi.json`, `apps/control-plane/src/tenant-management.mjs`, `services/adapters/src/storage-tenant-context.mjs`, `services/provisioning-orchestrator/src/repositories/tenant-rotation-policy-repo.mjs`.

### REQ-TEN-08 — Console operator entry points for tenants and members

**Description.** Two console pages give operators their primary entry point into a tenant: the catalog of tenants (with create wizard) and the membership lens that surfaces IAM realm users and roles for the active tenant.

**Acceptance criteria.**

- `ConsoleTenantsPage` exposes a primary CTA "Nuevo tenant" that opens a creation wizard; access is conditioned on the platform role (`platform_operator` / `superadmin`).
- `ConsoleMembersPage` requires an active tenant and refuses to render the user/role tables when the tenant has no `consoleUserRealm` configured in its `identityContext`.
- When an active tenant is selected, `ConsoleMembersPage` lists IAM realm users with their `realmRoles` and `requiredActions` badges, and lists IAM realm roles flagging composite roles.
- Both pages remain functional for principals without the `superadmin` role; superadmin-only actions degrade gracefully.

**Trace.**
`apps/web-console/src/pages/ConsoleTenantsPage.tsx`, `apps/web-console/src/pages/ConsoleTenantsPage.test.tsx`, `apps/web-console/src/pages/ConsoleMembersPage.tsx`, `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`.

## Cross-capability dependencies

- `identity-and-access` — tenant activation provisions the per-tenant Keycloak `identityContext` (platform realm reference, tenant realm strategy, console realm) via `services/adapters/src/keycloak-admin.mjs`. `ConsoleMembersPage` consumes `/v1/iam/realms/.../users` and `/v1/iam/realms/.../roles` to render the membership view; tenant IAM access toggle (`/v1/tenants/{id}/iam-access`) drives the IAM lifecycle events owned by IAM.
- `workspace-management` — tenant inventory and dashboard aggregate the workspaces, external applications, service accounts, and managed resources owned by `workspace-management`; tenant suspension propagates to descendant workspaces.
- `quota-and-billing` — every tenant references one plan, one quota policy, and one deployment profile from QTA; effective-capability resolution intersects QTA's plan and quota state with the tenant's deployment-profile bindings.
- `observability-and-audit` — every tenant lifecycle event, membership change, invitation transition, ownership transfer, IAM access toggle, and tenant-config admin run is consumed by the audit pipeline owned by OBS; tenant-config audit tables are read by OBS query/export surfaces.
- `secret-management` — tenant-scoped storage credentials and provisioning bootstrap secrets are distributed via External Secrets Operator + Vault; the orchestrator never stores secret material in tenant tables.
- `gateway-and-public-surface` — long-running tenant operations surface through the cross-capability operations console (`ConsoleOperationsPage`, `ConsoleOperationDetailPage`); the gateway also serves the admin `/v1/admin/tenants/.../config/*` paths today (see Q-TEN-01).
- `data-services` — provisioning bootstraps tenant-scoped Postgres / Mongo / object-storage namespaces through the adapters owned by DAT.

## Out of scope

- Workspace CRUD itself, workspace memberships, applications, federation providers, managed resources (`workspace-management`).
- IAM realm / client / role / scope / user administration via `/v1/iam/...` (`identity-and-access`).
- Plan and quota policy authoring, plan changes, plan/tenant allocation surfaces (`quota-and-billing`).
- Audit pipeline, audit storage, audit query / export / correlation surfaces (`observability-and-audit`).
- Backup and restore (`backup-and-restore`) — tenant export here is *functional configuration*, not data backup.
- Secret distribution and rotation flows (`secret-management`) — TEN consumes references only.
- Async-operation generic console pages (`gateway-and-public-surface`).

## Open questions

- **Q-TEN-01.** The three `ConsoleTenantConfig*` pages call `/v1/admin/tenants/{tenantId}/config/{export,reprovision/preflight,reprovision/identifier-map,reprovision}` which are *not* registered in `tenants.openapi.json` (or in any other `/v1/*` family). This is the same situation as Q-IAM-03. Decide whether to (a) promote them to first-class operations under `/v1/tenants/{tenantId}/config/...` in `tenants.openapi.json`, or (b) document them as an internal-only `/v1/admin/tenants/...` admin surface served behind APISIX. Today the public OpenAPI does not describe them.
- **Q-TEN-02.** `ConsoleTenantConfigExportPage`, `ConsoleTenantConfigPreflightPage`, and `ConsoleTenantConfigReprovisionPage` are present in `apps/web-console/src/pages/` but are not mounted in `apps/web-console/src/router.tsx`. They render as embedded sub-views with `tenantId` (and `userRole`) props. Decide whether each should gain a top-level console route (e.g. `/console/tenants/:tenantId/config/export`, `/console/tenants/:tenantId/config/preflight`, `/console/tenants/:tenantId/config/reprovision`) — same shape as the IAM Q-IAM-04 resolution.
- **Q-TEN-03.** `ConsoleMembersPage` is mapped to `tenant-lifecycle` by the catalog but its primary data source is `/v1/iam/realms/{realmId}/users` and `/v1/iam/realms/{realmId}/roles` — both owned by `identity-and-access`. `/v1/tenants/{tenantId}/memberships` is not consumed by the page today. Confirm whether the page belongs to TEN as a "tenant member view that consumes IAM" (current placement), or whether it should move to IAM as a tenant-scoped IAM lens. The catalog row should reflect the answer.
- **Q-TEN-04.** Tenant lifecycle event types (`tenant.created`, `tenant.activated`, `tenant.suspended`, `tenant.soft_deleted`, plus the parallel `tenant_membership.*` and `invitation.*` series) are declared in `services/internal-contracts/src/domain-model.json` but I did not find a backend module that explicitly emits them on `/v1/tenants/...` requests. The orchestrator emits the *config-export / preflight / reprovision* events, but the canonical tenant lifecycle events appear to be a contract-only baseline. Confirm where (and whether) they are emitted today, so the spec accurately claims the topics or marks them as planned.
