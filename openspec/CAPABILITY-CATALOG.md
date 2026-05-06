# Capability catalog (proposed)

> Output of prompt `01-onboard-and-discover` executed on 2026-05-05.
> Updated on 2026-05-06 after Andrea resolved the eleven Q-CAT-* questions.
> Updated on 2026-05-06 again, after Andrea resolved the five Q-IAM-* questions
> raised during the identity-and-access spec round (page reassignment, planned
> `/v1/iam/...` promotions, planned top-level console routes).
> Updated on 2026-05-06 again, after Andrea resolved the four Q-TEN-* questions
> raised during the tenant-lifecycle spec round (planned `/v1/tenants/.../config/...`
> promotion, planned top-level console routes for tenant-config pages, ConsoleMembersPage
> kept in TEN, canonical tenant lifecycle event emission mandated by REQ-TEN-09).
> Pending human review before any spec is generated.

## Proposed capabilities

| # | Slug | Prefix | One-liner | Owns route families | Owns pages | Owns services |
| - | ---- | ------ | --------- | ------------------- | ---------- | ------------- |
| 1 | identity-and-access | IAM | Authentication, sessions, IAM realms/users/clients/scopes, contextual authorization, privilege domains, scope enforcement, service-account credential lifecycle | `/v1/auth` (`auth.openapi.json`), `/v1/iam` (`iam.openapi.json`); planned per Q-IAM-03: promote the internal `/api/security/*` and `/api/workspaces/.../privilege-domains` paths to first-class operations under `/v1/iam/...` in `iam.openapi.json` | LoginPage, SignupPage, PendingActivationPage, ConsoleAuthPage, ConsoleServiceAccountsPage, ConsolePrivilegeDomainPage (planned route `/console/workspaces/:workspaceId/members/:memberId/privilege-domain`), ConsolePrivilegeDomainAuditPage (planned top-level console route, path TBD), ConsoleScopeEnforcementPage (planned top-level console route, path TBD) | `services/keycloak-config` (designated future home for Keycloak realm/client/role/scope config per Q-IAM-01; today contains only the early-seed `scopes/backup-*.yaml` set, while substantive Keycloak admin logic still lives in `services/adapters/src/keycloak-admin.mjs` and is invoked by `services/provisioning-orchestrator`) |
| 2 | tenant-lifecycle | TEN | Tenant CRUD, memberships, invitations, ownership transfers, reactivation, purge, tenant configuration export/preflight/reprovision, tenant-scoped exports and storage-context, canonical entity model, canonical tenant/membership/invitation lifecycle event emission | `/v1/tenants` (`tenants.openapi.json`); planned per Q-TEN-01: promote the internal `/v1/admin/tenants/{tenantId}/config/{export,reprovision/preflight,reprovision/identifier-map,reprovision}` paths to first-class operations under `/v1/tenants/{tenantId}/config/...` in `tenants.openapi.json` | ConsoleTenantsPage, ConsoleMembersPage (consumes IAM realm users/roles as a cross-capability dependency per Q-TEN-03), ConsoleTenantConfigExportPage (planned route `/console/tenants/:tenantId/config/export`), ConsoleTenantConfigPreflightPage (planned route `/console/tenants/:tenantId/config/preflight`), ConsoleTenantConfigReprovisionPage (planned route `/console/tenants/:tenantId/config/reprovision`) | `services/provisioning-orchestrator` |
| 3 | workspace-management | WSP | Workspace CRUD, workspace memberships, applications, federation providers, managed resources, workspace docs, workspace clone, service-account routing under workspaces, workspace capability catalog (postgres-database / mongo-collection enablement) | `/v1/workspaces` (`workspaces.openapi.json`) | ConsoleWorkspacesPage, ConsoleWorkspaceDashboardPage, ConsoleDocsPage, ConsoleCapabilityCatalogPage | `services/workspace-docs-service` |
| 4 | data-services | DAT | PostgreSQL, MongoDB and S3-compatible object storage management plus tenant-scoped data CRUD, schemas, credentials, exports/imports | `/v1/postgres` (`postgres.openapi.json`), `/v1/mongo` (`mongo.openapi.json`), `/v1/storage` (`storage.openapi.json`) | ConsolePostgresPage, ConsoleMongoPage, ConsoleStoragePage | `services/adapters` |
| 5 | functions-runtime | FN | OpenWhisk-backed functions, action versions, triggers (cron / Kafka / storage / HTTP), packages, rules, function secrets, activation logs | `/v1/functions` (`functions.openapi.json`) | ConsoleFunctionsPage | `services/scheduling-engine` |
| 6 | realtime-and-events | RTM | Kafka topic management, CDC capture summaries, realtime websockets, event bridges, webhook delivery | `/v1/events` (`events.openapi.json`), `/v1/websockets` (`websockets.openapi.json`), `/v1/workspaces/{id}/pg-captures` (`pg-captures.openapi.json`), `/v1/tenants/{id}/pg-captures/summary` (`pg-capture-tenant-summary.openapi.json`), `/v1/realtime/workspaces/{id}/mongo-captures` (`mongo-captures.openapi.json`), `/v1/realtime/tenants/{id}/mongo-captures/summary` (`mongo-capture-tenant-summary.openapi.json`) | ConsoleKafkaPage, ConsoleRealtimePage | `services/event-gateway`, `services/realtime-gateway`, `services/pg-cdc-bridge`, `services/mongo-cdc-bridge`, `services/webhook-engine` |
| 7 | observability-and-audit | OBS | Tenant/workspace metrics overviews, audit records / exports / correlations, dashboards, threshold alerts, the cross-cutting audit pipeline | `/v1/metrics` (`metrics.openapi.json`) | ConsoleObservabilityPage | `services/audit` |
| 8 | secret-management | SEC | Console-facing secret catalog, rotation flows, External Secrets Operator + Vault distribution contract, secret audit | _(none — cross-cutting concern, no `/v1/*` family)_ | ConsoleSecretsPage, ConsoleSecretRotationPage | `services/secret-audit-handler` |
| 9 | quota-and-billing | QTA | Commercial plans, quota policies, plan/tenant allocation, quotas console, plan governance, memberships/invitations/effective-capability resolution narrative from US-DOM-02 | `/v1/platform` (`platform.openapi.json`) — kept as one family per Q-CAT-01; recommended optional split into `platform-plans` / `platform-deployment` / `platform-users` before specs | ConsolePlanCatalogPage, ConsolePlanCreatePage, ConsolePlanDetailPage, ConsoleTenantPlanPage, ConsoleTenantPlanOverviewPage, ConsoleTenantAllocationSummaryPage, ConsoleQuotasPage | _(none — uses control-plane bounded contexts only)_ |
| 10 | backup-and-restore | BCK | Backup status surfaces, scope reporting, restore validation hints emitted by data-services exports | _(none yet — `/v1/backups` family must be created before BCK's first spec, per Q-CAT-09)_ | ConsoleBackupScopePage, admin/BackupStatusPage, tenant/BackupSummaryPage | `services/backup-status` |
| 11 | gateway-and-public-surface | GW | APISIX gateway config, public API contract aggregation, SDK generation, public landing/welcome surface, async-operation surfaces | _(none — owns the gateway itself, not a `/v1/*` family)_ | WelcomePage, NotFoundPage, ConsoleApiReferencePage, ConsoleOperationsPage, ConsoleOperationDetailPage, ConsolePlaceholderPage | `services/gateway-config`, `services/openapi-sdk-service` |
| 12 | deployment-and-operations | OPS | Helm umbrella chart, deployment profiles, provider capabilities, route catalog, image policy, service map, testing strategy, monorepo bootstrap | _(none — Helm + manifests, not a `/v1/*` family)_ | _(none — operates on infrastructure, not console pages)_ | _(none directly — owns `charts/in-falcone/` and the cross-service `services/internal-contracts/`)_ |

Cross-cutting note: `services/internal-contracts/` is shared by every capability that publishes a contract; it is not owned by a single capability and is governed by the OPS capability per `AGENTS.md` ("Never modify `services/internal-contracts/` without a change proposal").

## Mapping of legacy SpecKit files to capabilities

| Legacy file | Capability |
| ----------- | ---------- |
| docs/tasks/us-arc-01-t01.md | deployment-and-operations |
| docs/tasks/us-arc-02.md | deployment-and-operations |
| docs/tasks/us-arc-03.md | identity-and-access |
| docs/tasks/us-dep-01.md | deployment-and-operations |
| docs/tasks/us-dep-02.md | deployment-and-operations |
| docs/tasks/us-dep-03.md | deployment-and-operations |
| docs/tasks/us-dom-01.md | tenant-lifecycle |
| docs/tasks/us-dom-02.md | quota-and-billing |
| docs/tasks/us-evt-01.md | realtime-and-events |
| docs/tasks/us-evt-02.md | realtime-and-events |
| docs/tasks/us-evt-03.md | realtime-and-events |
| docs/tasks/us-fn-02.md | functions-runtime |
| docs/tasks/us-gw-01.md | gateway-and-public-surface |
| docs/tasks/us-gw-02.md | gateway-and-public-surface |
| docs/tasks/us-gw-03.md | gateway-and-public-surface |
| docs/tasks/us-iam-01.md | identity-and-access |
| docs/tasks/us-iam-02.md | identity-and-access |
| docs/tasks/us-iam-03.md | identity-and-access |
| docs/tasks/us-iam-04.md | identity-and-access |
| docs/tasks/us-iam-05.md | identity-and-access |
| docs/tasks/us-iam-06.md | identity-and-access |
| docs/tasks/us-mgadm-02.md | data-services |
| docs/tasks/us-mgadm-03.md | data-services |
| docs/tasks/us-mgdata-01.md | data-services |
| docs/tasks/us-mgdata-02.md | data-services |
| docs/tasks/us-mgdata-03.md | data-services |
| docs/tasks/us-obs-01.md | observability-and-audit |
| docs/tasks/us-obs-02.md | observability-and-audit |
| docs/tasks/us-obs-03.md | observability-and-audit |
| docs/tasks/us-pgadm-04.md | data-services |
| docs/tasks/us-pgadm-05.md | data-services |
| docs/tasks/us-pgdata-01.md | data-services |
| docs/tasks/us-pgdata-03.md | data-services |
| docs/tasks/us-prg-01-t01.md | deployment-and-operations |
| docs/tasks/us-prg-02-t01.md | data-services |
| docs/tasks/us-prg-03-t01.md | deployment-and-operations |
| docs/tasks/us-prg-04-t01.md | deployment-and-operations |
| docs/tasks/us-sto-03.md | data-services |
| docs/tasks/us-ten-01.md | tenant-lifecycle |
| docs/tasks/us-ten-02.md | tenant-lifecycle |
| docs/tasks/us-ten-04.md | tenant-lifecycle |

## Mapping of /v1/* route families to capabilities

| Route family | Capability |
| ------------ | ---------- |
| /v1/auth (auth.openapi.json) | identity-and-access |
| /v1/iam (iam.openapi.json) | identity-and-access |
| /v1/tenants (tenants.openapi.json) | tenant-lifecycle |
| /v1/workspaces (workspaces.openapi.json) | workspace-management |
| /v1/postgres (postgres.openapi.json) | data-services |
| /v1/mongo (mongo.openapi.json) | data-services |
| /v1/storage (storage.openapi.json) | data-services |
| /v1/functions (functions.openapi.json) | functions-runtime |
| /v1/events (events.openapi.json) | realtime-and-events |
| /v1/websockets (websockets.openapi.json) | realtime-and-events |
| /v1/workspaces/{id}/pg-captures (pg-captures.openapi.json) | realtime-and-events |
| /v1/tenants/{id}/pg-captures/summary (pg-capture-tenant-summary.openapi.json) | realtime-and-events |
| /v1/realtime/workspaces/{id}/mongo-captures (mongo-captures.openapi.json) | realtime-and-events |
| /v1/realtime/tenants/{id}/mongo-captures/summary (mongo-capture-tenant-summary.openapi.json) | realtime-and-events |
| /v1/metrics (metrics.openapi.json) | observability-and-audit |
| /v1/platform (platform.openapi.json) | quota-and-billing |

## Mapping of pages in apps/web-console/src/pages/ to capabilities

| Page | Capability |
| ---- | ---------- |
| LoginPage | identity-and-access |
| SignupPage | identity-and-access |
| PendingActivationPage | identity-and-access |
| ConsoleAuthPage | identity-and-access |
| ConsoleServiceAccountsPage | identity-and-access |
| ConsolePrivilegeDomainPage | identity-and-access |
| ConsolePrivilegeDomainAuditPage | identity-and-access |
| ConsoleScopeEnforcementPage | identity-and-access |
| ConsoleTenantsPage | tenant-lifecycle |
| ConsoleMembersPage | tenant-lifecycle |
| ConsoleTenantConfigExportPage | tenant-lifecycle |
| ConsoleTenantConfigPreflightPage | tenant-lifecycle |
| ConsoleTenantConfigReprovisionPage | tenant-lifecycle |
| ConsoleWorkspacesPage | workspace-management |
| ConsoleWorkspaceDashboardPage | workspace-management |
| ConsoleDocsPage | workspace-management |
| ConsoleCapabilityCatalogPage | workspace-management |
| ConsolePostgresPage | data-services |
| ConsoleMongoPage | data-services |
| ConsoleStoragePage | data-services |
| ConsoleFunctionsPage | functions-runtime |
| ConsoleKafkaPage | realtime-and-events |
| ConsoleRealtimePage | realtime-and-events |
| ConsoleObservabilityPage | observability-and-audit |
| ConsoleSecretsPage | secret-management |
| ConsoleSecretRotationPage | secret-management |
| ConsolePlanCatalogPage | quota-and-billing |
| ConsolePlanCreatePage | quota-and-billing |
| ConsolePlanDetailPage | quota-and-billing |
| ConsoleTenantPlanPage | quota-and-billing |
| ConsoleTenantPlanOverviewPage | quota-and-billing |
| ConsoleTenantAllocationSummaryPage | quota-and-billing |
| ConsoleQuotasPage | quota-and-billing |
| ConsoleBackupScopePage | backup-and-restore |
| admin/BackupStatusPage | backup-and-restore |
| tenant/BackupSummaryPage | backup-and-restore |
| WelcomePage | gateway-and-public-surface |
| NotFoundPage | gateway-and-public-surface |
| ConsoleApiReferencePage | gateway-and-public-surface |
| ConsoleOperationsPage | gateway-and-public-surface |
| ConsoleOperationDetailPage | gateway-and-public-surface |
| ConsolePlaceholderPage | gateway-and-public-surface |

## Resolved decisions (Q-CAT-* answered by Andrea on 2026-05-06)

- **Q-CAT-01 — Resolved.** Keep `/v1/platform` (`platform.openapi.json`) assigned to **quota-and-billing** because plans and quota policies dominate the path count and product narrative. Routes for deployment-profiles / provider-capabilities / route-catalog / storage-provider stay as cross-capability dependencies surfaced to `deployment-and-operations`, and `/v1/platform/users` remains a cross-capability dependency surfaced to `identity-and-access`. Optional follow-up: split the OpenAPI family into `platform-plans.openapi.json`, `platform-deployment.openapi.json`, and `platform-users.openapi.json` before generating the QTA spec, so each capability owns the OpenAPI fragment it actually uses.
- **Q-CAT-02 — Resolved.** Confirmed: `ConsoleServiceAccountsPage` belongs to **identity-and-access** while the underlying routes `/v1/workspaces/{id}/service-accounts*` stay in **workspace-management**. WSP exposes the route family; IAM consumes it as a cross-capability dependency for the page.
- **Q-CAT-03 — Resolved.** `us-dom-01.md` (canonical entity model) maps to **tenant-lifecycle** because tenants are the root of the entity tree.
- **Q-CAT-04 — Resolved.** `us-dom-02.md` (memberships, invitations, plans, quota policies, deployment profiles, provider capabilities, effective-capability resolution) maps to **quota-and-billing**.
- **Q-CAT-05 — Resolved.** **identity-and-access** owns the privilege-domain audit lens (`ConsolePrivilegeDomainAuditPage`).
- **Q-CAT-06 — Resolved.** `ConsoleOperationsPage` and `ConsoleOperationDetailPage` belong to **gateway-and-public-surface** because the page is a cross-tenant operational lens.
- **Q-CAT-07 — Resolved.** `ConsoleKafkaPage` belongs to **realtime-and-events**.
- **Q-CAT-08 — Deferred.** Keep object storage in **data-services** for now. Split into a dedicated `object-storage` capability **only if** storage grows its own page tree, lifecycle policies, or quota model. No action required for the current spec round.
- **Q-CAT-09 — Action required before BCK spec.** **backup-and-restore** must grow a `/v1/backups` route family (`apps/control-plane/openapi/families/backups.openapi.json`) before its first capability spec is generated. Until that file exists, BCK owns no `/v1/*` family.
- **Q-CAT-10 — Resolved.** `services/provisioning-orchestrator` belongs to **tenant-lifecycle** as the saga is for tenant creation; downstream workspace and data-service provisioning treat the saga as a cross-capability dependency.
- **Q-CAT-11 — Resolved.** `services/webhook-engine` belongs to **realtime-and-events** as webhook delivery is event egress.

## Resolved decisions (Q-IAM-* answered by Andrea on 2026-05-06 during the IAM spec round)

- **Q-IAM-01 — Resolved.** `services/keycloak-config/` is the future home for Keycloak realm, client, role, scope, and protocol-mapper configuration. Current `scopes/backup-*.yaml` contents are an early seed; substantive Keycloak admin logic stays in `services/adapters/src/keycloak-admin.mjs` until the directory is backfilled.
- **Q-IAM-02 — Resolved.** `ConsoleCapabilityCatalogPage` is reassigned from **identity-and-access** to **workspace-management**. The page is a workspace-capability catalog UI (postgres-database / mongo-collection enablement), not an IAM authorization-capability catalog. The catalog tables above reflect the move.
- **Q-IAM-03 — Resolved.** Privilege-domain assignment management and the privilege-domain / scope-enforcement denial query surfaces — currently served via the internal `/api/security/*` and `/api/workspaces/{workspaceId}/members/{memberId}/privilege-domains` paths through APISIX — will be promoted to first-class operations under `/v1/iam/...` in `iam.openapi.json` by a follow-up change proposal. Until that lands, the IAM front-end pages continue to call the internal `/api/*` paths.
- **Q-IAM-04 — Resolved.** Three IAM pages that today render only as embedded sub-views will gain top-level console routes: `ConsolePrivilegeDomainPage` → `/console/workspaces/:workspaceId/members/:memberId/privilege-domain`; `ConsolePrivilegeDomainAuditPage` → top-level console route, exact path TBD in the change proposal; `ConsoleScopeEnforcementPage` → top-level console route, exact path TBD in the change proposal.
- **Q-IAM-05 — Resolved.** Console login sessions, signups, and password-recovery requests are persisted Keycloak-side; no platform-DB tables are claimed for `/v1/auth/*` resources in the IAM spec.

## Resolved decisions (Q-TEN-* answered by Andrea on 2026-05-06 during the tenant-lifecycle spec round)

- **Q-TEN-01 — Resolved.** The tenant-config admin paths `/v1/admin/tenants/{tenantId}/config/{export,reprovision/preflight,reprovision/identifier-map,reprovision}` will be promoted to first-class operations under `/v1/tenants/{tenantId}/config/...` in `tenants.openapi.json` by a follow-up change proposal. Until that lands, the `ConsoleTenantConfig*` pages continue to call the `/v1/admin/tenants/...` paths.
- **Q-TEN-02 — Resolved.** Three tenant-config pages that today render only as embedded sub-views will gain top-level console routes: `ConsoleTenantConfigExportPage` → `/console/tenants/:tenantId/config/export`; `ConsoleTenantConfigPreflightPage` → `/console/tenants/:tenantId/config/preflight`; `ConsoleTenantConfigReprovisionPage` → `/console/tenants/:tenantId/config/reprovision`.
- **Q-TEN-03 — Resolved.** `ConsoleMembersPage` keeps its current placement in **tenant-lifecycle**. It is framed as "a tenant-scoped membership view that consumes IAM realm users and roles as a cross-capability dependency" (REQ-TEN-08).
- **Q-TEN-04 — Resolved.** The canonical tenant / tenant_membership / invitation lifecycle events declared in `services/internal-contracts/src/domain-model.json` (`tenant.{created,activated,suspended,soft_deleted}`, `tenant_membership.*`, `invitation.*`) MUST be emitted on every successful state transition. The tenant-lifecycle spec records this requirement as **REQ-TEN-09**, so any module that owns the lifecycle write path (today the candidate is the provisioning orchestrator together with a future `tenant-manager` handler in the control plane) must comply with it.
- **Q-TEN-05 — Action required before next TEN-touching change proposal.** REQ-TEN-09 is a contract requirement, but no backend module emits the canonical tenant/membership/invitation lifecycle events on `/v1/tenants/...` write paths today. A change proposal must (a) decide which module owns the emission (provisioning orchestrator, a new `tenant-manager` handler, or both, with the orchestrator emitting saga-internal events and the handler emitting business-level lifecycle events on terminal saga success), (b) wire up the emission, and (c) add validators / contract tests that assert REQ-TEN-09 holds.

## Open questions

- _None remaining._ All eleven Q-CAT-*, all five Q-IAM-*, and all four Q-TEN-* questions were resolved on 2026-05-06. Open follow-up actions tracked under Resolved decisions: the optional split of `platform.openapi.json` (Q-CAT-01); the required creation of `backups.openapi.json` (Q-CAT-09); the `/v1/iam/...` promotion change proposal (Q-IAM-03); the new top-level console routes for the privilege-domain / scope-enforcement pages (Q-IAM-04); the backfill of Keycloak realm/client/role/scope config under `services/keycloak-config/` (Q-IAM-01); the `/v1/tenants/.../config/...` promotion change proposal (Q-TEN-01); the new top-level console routes for the tenant-config pages (Q-TEN-02); and the canonical tenant lifecycle event emission wiring (Q-TEN-05).

## Suggested next step

1. Decide whether to split `platform.openapi.json` per Q-CAT-01 follow-up; if yes, do this before generating the QTA spec.
2. Create `apps/control-plane/openapi/families/backups.openapi.json` per Q-CAT-09 before generating the BCK spec.
3. Then proceed to generate the per-capability specs using prompt `02-generate-capability-spec.md`, one capability at a time. Recommended order: start with `identity-and-access` (foundational), then `tenant-lifecycle` and `workspace-management` (entity backbone), then the data/runtime capabilities (`data-services`, `functions-runtime`, `realtime-and-events`), then the cross-cutting ones (`observability-and-audit`, `secret-management`, `quota-and-billing`, `backup-and-restore`, `gateway-and-public-surface`, `deployment-and-operations`).
