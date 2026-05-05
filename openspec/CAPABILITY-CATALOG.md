# Capability catalog (proposed)

> Output of prompt `01-onboard-and-discover` executed on 2026-05-05.
> Pending human review before any spec is generated.

## Proposed capabilities

| # | Slug | Prefix | One-liner | Owns route families | Owns pages | Owns services |
| - | ---- | ------ | --------- | ------------------- | ---------- | ------------- |
| 1 | identity-and-access | IAM | Authentication, sessions, IAM realms/users/clients/scopes, contextual authorization, privilege domains, scope enforcement, service-account credential lifecycle | `/v1/auth` (`auth.openapi.json`), `/v1/iam` (`iam.openapi.json`) | LoginPage, SignupPage, PendingActivationPage, ConsoleAuthPage, ConsoleServiceAccountsPage, ConsoleCapabilityCatalogPage, ConsolePrivilegeDomainPage, ConsolePrivilegeDomainAuditPage, ConsoleScopeEnforcementPage | `services/keycloak-config` |
| 2 | tenant-lifecycle | TEN | Tenant CRUD, memberships, invitations, ownership transfers, reactivation, purge, tenant configuration export/preflight/reprovision, tenant-scoped exports and storage-context | `/v1/tenants` (`tenants.openapi.json`) | ConsoleTenantsPage, ConsoleMembersPage, ConsoleTenantConfigExportPage, ConsoleTenantConfigPreflightPage, ConsoleTenantConfigReprovisionPage | `services/provisioning-orchestrator` |
| 3 | workspace-management | WSP | Workspace CRUD, workspace memberships, applications, federation providers, managed resources, workspace docs, workspace clone | `/v1/workspaces` (`workspaces.openapi.json`) | ConsoleWorkspacesPage, ConsoleWorkspaceDashboardPage, ConsoleDocsPage | `services/workspace-docs-service` |
| 4 | data-services | DAT | PostgreSQL, MongoDB and S3-compatible object storage management plus tenant-scoped data CRUD, schemas, credentials, exports/imports | `/v1/postgres` (`postgres.openapi.json`), `/v1/mongo` (`mongo.openapi.json`), `/v1/storage` (`storage.openapi.json`) | ConsolePostgresPage, ConsoleMongoPage, ConsoleStoragePage | `services/adapters` |
| 5 | functions-runtime | FN | OpenWhisk-backed functions, action versions, triggers (cron / Kafka / storage / HTTP), packages, rules, function secrets, activation logs | `/v1/functions` (`functions.openapi.json`) | ConsoleFunctionsPage | `services/scheduling-engine` |
| 6 | realtime-and-events | RTM | Kafka topic management, CDC capture summaries, realtime websockets, event bridges, webhook delivery | `/v1/events` (`events.openapi.json`), `/v1/websockets` (`websockets.openapi.json`), `/v1/workspaces/{id}/pg-captures` (`pg-captures.openapi.json`), `/v1/tenants/{id}/pg-captures/summary` (`pg-capture-tenant-summary.openapi.json`), `/v1/realtime/workspaces/{id}/mongo-captures` (`mongo-captures.openapi.json`), `/v1/realtime/tenants/{id}/mongo-captures/summary` (`mongo-capture-tenant-summary.openapi.json`) | ConsoleKafkaPage, ConsoleRealtimePage | `services/event-gateway`, `services/realtime-gateway`, `services/pg-cdc-bridge`, `services/mongo-cdc-bridge`, `services/webhook-engine` |
| 7 | observability-and-audit | OBS | Tenant/workspace metrics overviews, audit records / exports / correlations, dashboards, threshold alerts, the cross-cutting audit pipeline | `/v1/metrics` (`metrics.openapi.json`) | ConsoleObservabilityPage | `services/audit` |
| 8 | secret-management | SEC | Console-facing secret catalog, rotation flows, External Secrets Operator + Vault distribution contract, secret audit | _(none — cross-cutting concern, no `/v1/*` family)_ | ConsoleSecretsPage, ConsoleSecretRotationPage | `services/secret-audit-handler` |
| 9 | quota-and-billing | QTA | Commercial plans, quota policies, plan/tenant allocation, quotas console, plan governance | `/v1/platform` (`platform.openapi.json`) — see Q-CAT-01 | ConsolePlanCatalogPage, ConsolePlanCreatePage, ConsolePlanDetailPage, ConsoleTenantPlanPage, ConsoleTenantPlanOverviewPage, ConsoleTenantAllocationSummaryPage, ConsoleQuotasPage | _(none — uses control-plane bounded contexts only)_ |
| 10 | backup-and-restore | BCK | Backup status surfaces, scope reporting, restore validation hints emitted by data-services exports | _(none — cross-cutting concern, no `/v1/*` family)_ | ConsoleBackupScopePage, admin/BackupStatusPage, tenant/BackupSummaryPage | `services/backup-status` |
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
| docs/tasks/us-dom-01.md | tenant-lifecycle *(see Q-CAT-03)* |
| docs/tasks/us-dom-02.md | quota-and-billing *(see Q-CAT-04)* |
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
| /v1/platform (platform.openapi.json) | quota-and-billing *(see Q-CAT-01)* |

## Mapping of pages in apps/web-console/src/pages/ to capabilities

| Page | Capability |
| ---- | ---------- |
| LoginPage | identity-and-access |
| SignupPage | identity-and-access |
| PendingActivationPage | identity-and-access |
| ConsoleAuthPage | identity-and-access |
| ConsoleServiceAccountsPage | identity-and-access *(see Q-CAT-02)* |
| ConsoleCapabilityCatalogPage | identity-and-access |
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
| ConsolePostgresPage | data-services |
| ConsoleMongoPage | data-services |
| ConsoleStoragePage | data-services *(see Q-CAT-08)* |
| ConsoleFunctionsPage | functions-runtime |
| ConsoleKafkaPage | realtime-and-events *(see Q-CAT-07)* |
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
| ConsoleOperationsPage | gateway-and-public-surface *(see Q-CAT-06)* |
| ConsoleOperationDetailPage | gateway-and-public-surface *(see Q-CAT-06)* |
| ConsolePlaceholderPage | gateway-and-public-surface |

## Open questions

- **Q-CAT-01** — `platform.openapi.json` is one route family but its paths split across three capabilities: `/v1/platform/plans` and `/v1/platform/plans/{planId}/quota-policies` map to **quota-and-billing**, while `/v1/platform/deployment-profiles`, `/v1/platform/provider-capabilities`, `/v1/platform/route-catalog`, `/v1/platform/storage/provider` are **deployment-and-operations** concerns, and `/v1/platform/users` is **identity-and-access**. The conventions require one capability per route family. Proposed: keep the family assigned to `quota-and-billing` (plans/quotas dominate the path count and product narrative) and treat the others as cross-capability dependencies, or split the OpenAPI family into `platform-plans.openapi.json`, `platform-deployment.openapi.json`, `platform-users.openapi.json` before generating specs.
- **Q-CAT-02** — Service-account routes live under `/v1/workspaces/{workspaceId}/service-accounts*` (workspaces family, owned by **workspace-management**), but the page `ConsoleServiceAccountsPage` is conceptually IAM. Proposed mapping above puts the page in **identity-and-access** while the routes stay in **workspace-management**. Confirm this split or move the routes by extracting a `service-accounts.openapi.json` family.
- **Q-CAT-03** — `us-dom-01.md` defines the canonical entity model (platform users, tenants, workspaces, external applications, service accounts, managed resources). It spans IAM + TEN + WSP. Proposed mapping: **tenant-lifecycle**, since tenants are the root of the entity tree. Alternative: split-trace it across the three capabilities.
- **Q-CAT-04** — `us-dom-02.md` covers memberships, invitations, plans, quota policies, deployment profiles, provider capabilities, and effective-capability resolution. It spans QTA + TEN + OPS + IAM. Proposed mapping: **quota-and-billing** (plans + quota policies dominate). Confirm or split.
- **Q-CAT-05** — Privilege domains and scope enforcement (ADRs 093 and 094, pages `ConsolePrivilegeDomainPage`, `ConsolePrivilegeDomainAuditPage`, `ConsoleScopeEnforcementPage`) are placed in **identity-and-access** as part of the contextual authorization model from ADR 0005. Confirm IAM owns the privilege-domain audit lens, or split it into **observability-and-audit** because it is read-only audit UI.
- **Q-CAT-06** — `ConsoleOperationsPage` and `ConsoleOperationDetailPage` are the async-job-status surfaces (ADRs 073, 074, 077). The underlying routes are `/v1/tenants/{id}/workflow-jobs/{jobRef}` (TEN) and `/v1/workspaces/{id}/workflow-jobs/{jobRef}` (WSP). Proposed mapping: **gateway-and-public-surface** because the page is a cross-tenant operational lens. Alternatives: TEN, or a new capability `async-operations`.
- **Q-CAT-07** — `ConsoleKafkaPage` is mapped to **realtime-and-events** (Kafka is event infrastructure, no dedicated `/v1/kafka` family exists; topics live under `/v1/events`). Confirm this, or carve out a separate `messaging-services` capability if Kafka grows beyond eventing.
- **Q-CAT-08** — Object storage is grouped into **data-services** alongside Postgres and Mongo. The S3-compatible surface is conceptually distinct from relational/document databases. Consider splitting into a dedicated `object-storage` capability if storage grows its own page tree, lifecycle policies, or quota model.
- **Q-CAT-09** — **backup-and-restore** owns no `/v1/*` route family today; backup operations are surfaced indirectly via `tenants` exports, `postgres` and `mongo` export endpoints, and `services/backup-status`. Decide whether BCK should remain a routeless cross-cutting capability (like SEC) or should grow a `/v1/backups` family before its first spec.
- **Q-CAT-10** — `services/provisioning-orchestrator` is currently mapped to **tenant-lifecycle** because tenant creation is its primary saga. It also drives workspace and data-service provisioning. Confirm the saga belongs to TEN, or designate it as cross-cutting (owned by OPS) with TEN as its primary consumer.
- **Q-CAT-11** — `services/webhook-engine` is mapped to **realtime-and-events** (webhook delivery is event egress). It could alternatively live under **functions-runtime** (webhooks are HTTP callbacks). Confirm RTM ownership.

## Suggested next step

Once Andrea approves this catalog (or proposes adjustments — particularly for the eleven open questions above), proceed to generate the per-capability specs using prompt `02-generate-capability-spec.md`, one capability at a time. Recommended order: start with `identity-and-access` (foundational), then `tenant-lifecycle` and `workspace-management` (entity backbone), then the data/runtime capabilities (`data-services`, `functions-runtime`, `realtime-and-events`), then the cross-cutting ones (`observability-and-audit`, `secret-management`, `quota-and-billing`, `backup-and-restore`, `gateway-and-public-surface`, `deployment-and-operations`).
