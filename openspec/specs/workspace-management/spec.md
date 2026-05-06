# workspace-management

## Purpose

This capability owns the workspace as the delegated delivery and runtime boundary inside one tenant: workspace CRUD, lifecycle and inheritance policy, workspace memberships, external applications and their federation providers, service accounts and their credential lifecycle, the managed-resource registry (database, bucket, topic, function), workspace clone with lineage, the workspace API-surface descriptor, and the workspace-scoped effective-capability projection. It also owns the workspace capability catalog seed (postgres-database, mongo-collection, kafka-events, realtime-subscription, serverless-function, storage-bucket) and the auto-assembled workspace documentation surface served by `services/workspace-docs-service`. Workspaces inherit identity, plan, deployment-profile, and storage-context from their parent tenant; tenant suspension or soft-delete cascades to workspace state. Cross-tenant or cross-workspace references are invalid by default per ADR 0006.

## Surfaces

- **Public REST endpoints**:
  - `/v1/workspaces` (`apps/control-plane/openapi/families/workspaces.openapi.json`) — `GET /v1/workspaces`, `POST /v1/workspaces`, `GET /v1/workspaces/{workspaceId}`, `PUT /v1/workspaces/{workspaceId}`, `DELETE /v1/workspaces/{workspaceId}` (soft-delete preserving clone lineage); `GET /v1/workspaces/{workspaceId}/api-surface`; applications (`GET /applications`, `POST /applications`, `GET /applications/templates`, `GET /applications/{applicationId}`, `PUT /applications/{applicationId}`); federation providers (`GET /applications/{applicationId}/federation/providers`, `POST /applications/{applicationId}/federation/providers`, `GET .../providers/{providerId}`, `PUT .../providers/{providerId}`); `POST /v1/workspaces/{workspaceId}/clone`; `GET /v1/workspaces/{workspaceId}/effective-capabilities`; managed resources (`POST /managed-resources`, `GET /managed-resources/{resourceId}`); memberships (`POST /memberships`, `GET /memberships/{workspaceMembershipId}`); `GET /v1/workspaces/{workspaceId}/permission-recalculations/{permissionRecalculationId}`; service accounts (`POST /service-accounts`, `GET /service-accounts/{serviceAccountId}`, `POST /service-accounts/{serviceAccountId}/credential-issuance`, `POST /credential-revocations`, `POST /credential-rotations`); `GET /v1/workspaces/{workspaceId}/workflow-jobs/{jobRef}`.
- **Frontend pages**:
  - `ConsoleWorkspacesPage` → `/console/workspaces`
  - `ConsoleWorkspaceDashboardPage` → `/console/workspaces/:workspaceId`
  - `ConsoleDocsPage` → `/console/workspaces/:workspaceId/docs`
  - `ConsoleCapabilityCatalogPage` → _(missing route)_ — reassigned to `workspace-management` per Q-IAM-02; today rendered as an embedded sub-view receiving `workspaceId` and an injectable `fetcher` via props (no top-level console route is mounted for it in `apps/web-console/src/router.tsx`); see Q-WSP-03 for the proposed top-level route.
- **Internal contracts**:
  - `services/internal-contracts/src/domain-model.json` — workspace, workspace_membership, external_application, service_account, managed_resource entities; lifecycle states; relationship rules; `WorkspaceIamBoundary.keyPolicy`; `resourceInheritance` rules.
  - `services/internal-contracts/src/workspace-capability-catalog-response.json`, `services/internal-contracts/src/workspace-capability-catalog-accessed-event.json` — workspace capability catalog response and access-event envelopes consumed by `ConsoleCapabilityCatalogPage`.
  - `services/internal-contracts/src/workspace-doc-note.json`, `services/internal-contracts/src/workspace-docs-response.json`, `services/internal-contracts/src/workspace-docs-accessed-event.json` — workspace docs envelope and access-event used by `services/workspace-docs-service`.
  - `services/internal-contracts/src/snippet-catalog-data.json` — snippet templates that the workspace docs assembler interpolates with the workspace context.
  - `apps/control-plane/src/workspace-management.mjs` exports `summarizeWorkspaceManagementSurface`, `buildWorkspaceCloneDraft`, `resolveWorkspaceApiSurface`, `resolveWorkspaceResourceInheritance` consumed by the control-plane handlers.
- **Kafka topics emitted**:
  - Canonical workspace lifecycle events declared in `services/internal-contracts/src/domain-model.json`: `workspace.{created,activated,suspended,soft_deleted}`; `workspace_membership.{created,activated,suspended,soft_deleted}`; `external_application.{created,activated,suspended,soft_deleted}`; `service_account.{created,activated,suspended,soft_deleted}`; `managed_resource.{created,activated,suspended,soft_deleted}`. Required by REQ-WSP-10; emission gap tracked under Q-WSP-04.
  - Workspace docs access event: `workspace.docs.accessed` per `services/internal-contracts/src/workspace-docs-accessed-event.json`, emitted by `services/workspace-docs-service`.
  - Workspace capability catalog access event: declared in `services/internal-contracts/src/workspace-capability-catalog-accessed-event.json`.
- **Kafka topics consumed**:
  - _None directly._ The capability does not subscribe to upstream topics; it reacts to synchronous orchestrator results when workspace-related sagas terminate.
- **PostgreSQL tables owned**:
  - `workspace_doc_notes`, `workspace_doc_access_log` (created by `services/workspace-docs-service/migrations/087-workspace-doc-notes.sql`, in the `workspace_docs_service` schema).
  - `capability_catalog_metadata` (created by `services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql`, seeded with the six canonical capability keys: `postgres-database`, `mongo-collection`, `kafka-events`, `realtime-subscription`, `serverless-function`, `storage-bucket`).

## Behaviour

### REQ-WSP-01 — Workspace CRUD with explicit lifecycle and tenant-safe slug uniqueness

**Description.** A workspace is a canonical entity scoped to exactly one tenant. Lifecycle states and transitions follow the shared baseline in ADR 0006; soft-delete preserves clone lineage and audit metadata; per-tenant uniqueness applies to workspace name and slug while still allowing multiple environments per tenant.

**Acceptance criteria.**

- `POST /v1/workspaces` accepts a canonical workspace write request with IAM boundary, environment, slug, lifecycle policy, and inheritance rules; the response carries the workspace in `draft` or `provisioning` state.
- `PUT /v1/workspaces/{workspaceId}` updates IAM, lifecycle, and inheritance settings; descendant entities cannot remain `active` once the workspace is `suspended` or `soft_deleted` (per `domain-model.json`).
- `DELETE /v1/workspaces/{workspaceId}` performs a logical delete that preserves audit and clone lineage metadata; the identifier is reserved.
- Workspace slug uniqueness is enforced per tenant; the same slug may be reused in a different tenant, and multiple environments may share a slug under the same tenant only when the canonical model permits (per `resolveWorkspaceResourceInheritance`).

**Trace.**
`apps/control-plane/openapi/families/workspaces.openapi.json`, `apps/control-plane/src/workspace-management.mjs`, `services/internal-contracts/src/domain-model.json`, `docs/adr/0006-core-domain-entity-model.md`, `docs/tasks/us-ten-02.md`.

### REQ-WSP-02 — Workspace memberships and effective-permission recalculation

**Description.** A platform user becomes a workspace participant only through an explicit `workspace_membership` record. Workspace memberships are tenant-safe: they cannot widen the parent tenant's authority. Membership writes trigger an effective-permission recalculation that consumers can poll.

**Acceptance criteria.**

- `POST /v1/workspaces/{workspaceId}/memberships` creates a membership record with explicit role; revocation goes through `soft_delete` rather than physical delete.
- `GET /v1/workspaces/{workspaceId}/memberships/{workspaceMembershipId}` returns the membership record with role, scope, and lifecycle state.
- `GET /v1/workspaces/{workspaceId}/permission-recalculations/{permissionRecalculationId}` returns the in-progress or final state of a recalculation triggered by a membership or IAM-access change.
- A workspace-scoped membership write does not produce a tenant-scoped membership; cross-tenant references are rejected.

**Trace.**
`apps/control-plane/openapi/families/workspaces.openapi.json`, `services/internal-contracts/src/domain-model.json`, `docs/adr/0007-membership-plan-governance.md`.

### REQ-WSP-03 — External applications and federated identity providers

**Description.** Each workspace exposes a registry of external applications (SPA, confidential backend, B2B SAML) plus their federated OIDC and SAML providers. Application configuration normalises authentication flows, redirect URIs, scopes, federation, logout endpoints, and role mappers under one canonical contract.

**Acceptance criteria.**

- `GET /v1/workspaces/{workspaceId}/applications` lists external applications with authentication flows, validation status, and metadata; `GET /applications/templates` returns starter templates for SPA, confidential backend, and B2B SAML.
- `POST /applications` and `PUT /applications/{applicationId}` accept the canonical write shape covering `protocol` ∈ {`oidc`, `saml`, `api_key`}, `redirectUris`, `scopes`, `authenticationFlows`, federation, logout, and role bindings; raw provider payloads are not exposed to callers.
- Federation provider CRUD (`GET/POST /applications/{applicationId}/federation/providers`, `GET/PUT .../providers/{providerId}`) accepts OIDC manual-endpoint and SAML metadata-attachment modes and exposes a normalised provider envelope.
- An external application cannot reference a service account or managed resource from another workspace (per `domain-model.json` integrity rules).

**Trace.**
`apps/control-plane/openapi/families/workspaces.openapi.json`, `services/internal-contracts/src/domain-model.json`, `apps/web-console/src/pages/ConsoleAuthPage.test.tsx`, `docs/tasks/us-ten-02.md`.

### REQ-WSP-04 — Service accounts and credential lifecycle

**Description.** Each workspace owns a registry of service accounts (workspace-local, non-human identities). Credentials are reference-first: the canonical model never carries raw secret material. Issue, revoke, and rotate are first-class operations and emit one audited transition each.

**Acceptance criteria.**

- `POST /v1/workspaces/{workspaceId}/service-accounts` creates a service account; `GET /service-accounts/{serviceAccountId}` returns the canonical entity with desired state, expiration, credential status, and access projection.
- `POST /service-accounts/{serviceAccountId}/credential-issuance` returns a fresh credential reference exactly once; the secret value is shown to the caller in the response and is not retrievable afterwards.
- `POST /credential-revocations` invalidates one or all active credential references; the API contract returns a non-recoverable confirmation, and the corresponding console action shows a `WARNING` confirmation dialog before revocation (per `ConsoleServiceAccountsPage.test.tsx`).
- `POST /credential-rotations` issues a new active credential reference and supersedes the previous one; the workspace-local IAM client is preserved.

**Trace.**
`apps/control-plane/openapi/families/workspaces.openapi.json`, `services/internal-contracts/src/domain-model.json`, `apps/web-console/src/pages/ConsoleServiceAccountsPage.test.tsx`, `docs/adr/0009-keycloak-platform-and-tenant-iam.md`.

### REQ-WSP-05 — Managed-resource registry inside a workspace

**Description.** Every workspace owns a registry of managed resources of kinds `database`, `bucket`, `topic`, and `function`. The registry is the single point of reference for the resource's logical identifier, sharing scope, and consuming applications/service accounts; the actual provisioning of the underlying database / bucket / topic / function is delegated to the relevant capability.

**Acceptance criteria.**

- `POST /v1/workspaces/{workspaceId}/managed-resources` accepts a canonical write request that declares `logical_resource_key`, `kind` ∈ {`database`, `bucket`, `topic`, `function`}, optional `sharingScope`, and authorised application / service-account sets.
- `GET /v1/workspaces/{workspaceId}/managed-resources/{resourceId}` returns the canonical entity including tenant-shared bindings (`sharingScope`, `consumerWorkspaceIds`) when applicable.
- A managed resource cannot reference an application or service account from another workspace; tenant-shared resources may be consumed by multiple workspaces but their canonical owner remains a single workspace.
- The managed-resource registry never owns the underlying data plane; details such as PostgreSQL schemas, Mongo collections, Kafka topics, OpenWhisk actions, or S3 buckets live in `data-services`, `realtime-and-events`, or `functions-runtime`.

**Trace.**
`apps/control-plane/openapi/families/workspaces.openapi.json`, `services/internal-contracts/src/domain-model.json`, `docs/tasks/us-ten-02.md`.

### REQ-WSP-06 — Workspace clone with lineage and credential reset policy

**Description.** A workspace can be cloned into a new environment. The clone records lineage (source workspace, generated identifiers), can reset application and credential state, and runs as an async operation surfaced through the workflow-jobs route.

**Acceptance criteria.**

- `POST /v1/workspaces/{workspaceId}/clone` accepts a clone request specifying target environment, optional application reset policy, and optional credential-reset policy; the response returns a workflow-job reference.
- The clone draft is built from `buildWorkspaceCloneDraft` in `apps/control-plane/src/workspace-management.mjs`; the draft preserves canonical entity identifiers' generation rules and respects per-tenant slug uniqueness.
- Clone runs are tracked through `GET /v1/workspaces/{workspaceId}/workflow-jobs/{jobRef}`; failures surface through the saga / async-operation surfaces (REQ-TEN-06 in tenant-lifecycle).
- The clone never reuses secret material from the source workspace; new credentials are generated when the credential-reset policy requires it.

**Trace.**
`apps/control-plane/openapi/families/workspaces.openapi.json`, `apps/control-plane/src/workspace-management.mjs`, `services/internal-contracts/src/domain-model.json`, `docs/tasks/us-ten-02.md`.

### REQ-WSP-07 — Workspace API surface and effective capabilities

**Description.** Each workspace exposes a deterministic API-surface descriptor (base URLs, application endpoint bindings, scope hints) for external clients, plus a workspace-scoped effective-capability projection that intersects plan, quota, deployment-profile, and provider availability.

**Acceptance criteria.**

- `GET /v1/workspaces/{workspaceId}/api-surface` returns workspace-specific base URLs and application endpoint bindings, computed by `resolveWorkspaceApiSurface`; the descriptor is deterministic for a given workspace context.
- `GET /v1/workspaces/{workspaceId}/effective-capabilities` returns the intersection of plan entitlements, quota policy limits, deployment-profile topology, and provider capability availability for the workspace; a capability is enabled only when all four layers agree (parallel to REQ-TEN-04 at workspace scope).
- Workspace resolution may narrow but never widen the tenant entitlement (per ADR 0007 § "Effective capability resolution").
- The API-surface descriptor never includes secret material or raw provider credentials.

**Trace.**
`apps/control-plane/openapi/families/workspaces.openapi.json`, `apps/control-plane/src/workspace-management.mjs`, `services/internal-contracts/src/domain-model.json`, `docs/adr/0007-membership-plan-governance.md`.

### REQ-WSP-08 — Workspace capability catalog (page + seed)

**Description.** The workspace capability catalog enumerates platform capabilities (postgres-database, mongo-collection, kafka-events, realtime-subscription, serverless-function, storage-bucket) for a given workspace, with their current `enabled` state, `status`, optional examples, and an `enablementGuide` shown when the capability is not yet enabled. The catalog is read by `ConsoleCapabilityCatalogPage` and is seeded by the `capability_catalog_metadata` table.

**Acceptance criteria.**

- `ConsoleCapabilityCatalogPage` renders enabled capabilities with their per-operation example snippets and renders disabled capabilities with their `enablementGuide`; transitional `status` values (e.g. `provisioning`) are displayed as a status badge.
- The catalog response shape matches `services/internal-contracts/src/workspace-capability-catalog-response.json`; access events match `workspace-capability-catalog-accessed-event.json`.
- The catalog seed in `capability_catalog_metadata` declares exactly the six canonical capability keys above with their `category` (`data` / `messaging` / `compute` / `storage`) and dependency graph (e.g. `realtime-subscription` depends on `kafka-events`).
- The page is resilient: it shows a loading state while the fetcher runs and an error state with a `Retry` action when the fetcher rejects.

**Trace.**
`apps/web-console/src/pages/ConsoleCapabilityCatalogPage.tsx`, `apps/web-console/src/pages/ConsoleCapabilityCatalogPage.test.tsx`, `services/internal-contracts/src/workspace-capability-catalog-response.json`, `services/provisioning-orchestrator/src/migrations/090-workspace-capability-catalog.sql`, `services/workspace-docs-service/src/capability-catalog-builder.mjs`.

### REQ-WSP-09 — Auto-assembled workspace documentation

**Description.** Each workspace gets an auto-assembled documentation surface that combines its API-surface descriptor, its effective capabilities, the snippet catalog interpolated with the workspace context, optional rotation-procedure section, and a workspace-local notes section that workspace admins can edit.

**Acceptance criteria.**

- `ConsoleDocsPage` (mounted at `/console/workspaces/:workspaceId/docs`) renders a header with `baseUrl` and `generatedAt`, a `Refresh` action, an authentication-instructions block, the per-service sections, and the notes panel.
- The docs assembler `services/workspace-docs-service/src/doc-assembler.mjs` runs upstream calls (API surface and effective capabilities) under a 2-second timeout; on timeout it raises `UPSTREAM_UNAVAILABLE` (HTTP 503) and the page renders the error state.
- Note creation, update, and soft-delete are restricted to roles in `workspace_admin` / `workspace_owner`; viewer roles (`workspace_viewer`, `developer_external`) can read but not mutate.
- Each docs read emits one `workspace.docs.accessed` event per `(workspaceId, actorId, accessDate)` triple, matching `services/internal-contracts/src/workspace-docs-accessed-event.json`.

**Trace.**
`apps/web-console/src/pages/ConsoleDocsPage.tsx`, `services/workspace-docs-service/src/doc-assembler.mjs`, `services/workspace-docs-service/actions/workspace-docs.mjs`, `services/workspace-docs-service/migrations/087-workspace-doc-notes.sql`, `services/internal-contracts/src/workspace-docs-accessed-event.json`.

### REQ-WSP-10 — Canonical workspace lifecycle event emission

**Description.** Every workspace, workspace-membership, external-application, service-account, and managed-resource state transition MUST emit the canonical lifecycle event declared in the core domain model. Emission ownership follows the same split decided for tenant-lifecycle (Q-TEN-05): the provisioning orchestrator emits saga-internal events; a control-plane workspace-manager handler emits the business-level canonical lifecycle events on terminal-saga success, exactly once per transition. Wiring is the responsibility of the future change proposal `wire-workspace-lifecycle-event-emission` (mirror of `wire-tenant-lifecycle-event-emission`); see Q-WSP-04.

**Acceptance criteria.**

- Every successful workspace transition (`create`, `activate`, `suspend`, `soft_delete`) emits exactly one event with `event_type` ∈ {`workspace.created`, `workspace.activated`, `workspace.suspended`, `workspace.soft_deleted`} carrying tenant + workspace binding, correlation id, actor, before/after state, and idempotency key.
- The same shape applies to `workspace_membership.{created,activated,suspended,soft_deleted}`, `external_application.{created,activated,suspended,soft_deleted}`, `service_account.{created,activated,suspended,soft_deleted}`, and `managed_resource.{created,activated,suspended,soft_deleted}`.
- Failed transitions DO NOT emit a business-level lifecycle event; failures are recorded through the saga / async-operation surfaces (REQ-TEN-06). Replays under the same idempotency key MUST NOT re-emit.
- Workspace-scoped events carry both `tenant_id` and `workspace_id`; tenant-scoped events emitted by tenant-lifecycle never duplicate the workspace-scoped emission.

**Trace.**
`services/internal-contracts/src/domain-model.json`, `docs/adr/0006-core-domain-entity-model.md`, `docs/adr/0007-membership-plan-governance.md`, `openspec/changes/wire-tenant-lifecycle-event-emission/design.md` (the design for the parallel TEN emission, reused as the WSP pattern).

## Cross-capability dependencies

- `tenant-lifecycle` — workspaces inherit the parent tenant's `identityContext`, plan, deployment profile, and storage context; tenant suspension or soft-delete cascades to workspace state. Tenant inventory and effective-capability surfaces aggregate workspace data owned by this capability.
- `identity-and-access` — workspace IAM boundary maps to a Keycloak client namespace inside the tenant realm (per ADR 0009); service accounts map to confidential clients; `ConsoleServiceAccountsPage` (page owned by IAM) consumes the `/v1/workspaces/.../service-accounts*` routes owned here. Privilege-domain assignments are workspace-scoped (`/api/workspaces/{wsId}/members/.../privilege-domains`, planned `/v1/iam/...` per Q-IAM-03).
- `data-services` — managed resources of kinds `database` and `bucket` are referenced here, but the actual Postgres / Mongo / object-storage surfaces (`/v1/postgres`, `/v1/mongo`, `/v1/storage`) are owned by DAT.
- `functions-runtime` — managed resources of kind `function` are referenced here; the OpenWhisk action lifecycle and the `/v1/functions` family are owned by FN.
- `realtime-and-events` — managed resources of kind `topic` are referenced here; Kafka topic governance, websockets, and CDC capture surfaces (`/v1/events`, `/v1/websockets`, `/v1/.../pg-captures`, `/v1/.../mongo-captures`) are owned by RTM.
- `quota-and-billing` — workspace consumption (`getWorkspaceConsumption`), workspace sub-quotas, and the plan-driven capability resolution are owned by QTA; `ConsoleWorkspaceDashboardPage` consumes QTA's plan-management API to render quota tables.
- `observability-and-audit` — workspace lifecycle events, docs access events, and capability-catalog access events are consumed by the audit pipeline owned by OBS; workspace-scoped metrics live at `/v1/metrics/workspaces/{workspaceId}/...`.
- `secret-management` — service-account credentials, federation-provider client secrets, and workspace key-policy are distributed via External Secrets Operator + Vault; this capability stores references only.
- `gateway-and-public-surface` — workspace API surface descriptors expose URLs that route through APISIX; long-running workspace operations surface through the cross-capability operations console.

## Out of scope

- Tenant CRUD itself, tenant memberships, invitations, ownership transfers (`tenant-lifecycle`).
- IAM realm / client / role / scope / user administration via `/v1/iam/...` (`identity-and-access`).
- The actual data-plane surfaces for Postgres / Mongo / object storage (`data-services`).
- The OpenWhisk action / trigger / package surfaces (`functions-runtime`).
- The Kafka topic / websocket / CDC capture surfaces (`realtime-and-events`).
- Plan and quota policy authoring; quota CRUD and tenant-allocation surfaces (`quota-and-billing`).
- Audit pipeline storage and audit query / export / correlation surfaces (`observability-and-audit`).
- Backup and restore surfaces (`backup-and-restore`).
- Secret distribution and rotation (`secret-management`) — workspace credentials are reference-first here.

## Open questions

- **Q-WSP-01.** `docs/tasks/us-ten-02.md` is mapped to `tenant-lifecycle` by the catalog, but its title is "Gestión de workspaces y API propia por workspace" and its scope-delivered section is entirely about workspace CRUD, workspace IAM key policy, workspace inheritance, workspace clone, and `GET /v1/workspaces/{workspaceId}/api-surface`. The user-story content belongs to `workspace-management`, not `tenant-lifecycle`. Recommend reassigning `us-ten-02.md` to `workspace-management` in `CAPABILITY-CATALOG.md`. (No `us-wsp-*.md` file exists today; `us-ten-02.md` is the only narrative source for WSP and is currently traced from the WSP REQs.)
- **Q-WSP-02.** `ConsoleWorkspaceDashboardPage.tsx` and `ConsoleDocsPage.tsx` exist as page components but have no `*.test.tsx` siblings under `apps/web-console/src/pages/`. Confirm whether tests are intentionally absent (e2e coverage only) or whether unit tests are missing and should be added.
- **Q-WSP-03.** `ConsoleCapabilityCatalogPage` was reassigned to `workspace-management` per Q-IAM-02 but has no top-level console route in `apps/web-console/src/router.tsx` — it is rendered as an embedded sub-view receiving `workspaceId` and `fetcher` via props. Decide a top-level console route (the natural shape would be `/console/workspaces/:workspaceId/capabilities`) — same shape as Q-IAM-04 and Q-TEN-02 resolutions.
- **Q-WSP-04.** REQ-WSP-10 mandates emission of canonical workspace / membership / external-application / service-account / managed-resource lifecycle events declared in `domain-model.json`, but no backend module emits them today (mirror of Q-TEN-04 / Q-TEN-05). Recommend a follow-up change proposal `wire-workspace-lifecycle-event-emission` that reuses the architectural decision documented in `openspec/changes/wire-tenant-lifecycle-event-emission/design.md` (orchestrator emits saga-internal events; a new `workspace-manager` control-plane handler emits business-level events on terminal-saga success; single `workspace.lifecycle` topic with `event_type` discriminator; `workspace_lifecycle_event_dedupe` table for idempotency).
- **Q-WSP-05.** `ConsoleWorkspaceDashboardPage` calls `planManagementApi.getWorkspaceConsumption` from `@/services/planManagementApi`. The plan-management surface is owned by `quota-and-billing` per the catalog, but the page rendering it is owned by `workspace-management`. The current arrangement (workspace page consumes QTA API as a cross-capability dependency) is consistent with the catalog; confirm framing and capture in REQ-WSP-07's cross-capability list. No catalog change needed unless the page should move to QTA as a workspace-scoped quota lens.
