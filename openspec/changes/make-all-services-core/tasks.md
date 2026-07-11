# Tasks: make-all-services-core

Command: `/system-change` - issue #898 - implementer handoff from the architect stage.

## T01: Confirm baseline green

- [x] Run the current repository validators before editing where feasible:
  `corepack pnpm validate:repo`, `corepack pnpm lint:md`, `corepack pnpm lint:snippets`, and the
  relevant chart/render/unit subsets.
- [x] Record any pre-existing failures in the implementation notes before changing chart behavior.

## T02: Remove Helm dependency optionality

- [x] Remove every platform-service `condition:` from `charts/in-falcone/Chart.yaml`.
- [x] Regenerate `charts/in-falcone/Chart.lock` and packaged dependencies with
  `helm dependency build charts/in-falcone`.
- [x] Add a render/static assertion that umbrella dependencies carry no `condition` field.

## T03: Remove component-wrapper service gates

- [x] Remove top-level `enabled` from `charts/in-falcone/charts/component-wrapper/values.schema.json`.
- [x] Remove the top-level workload gate in `templates/workload.yaml`.
- [x] Update Service/PVC/ConfigMap/ServiceAccount templates to gate only on object-level settings:
  `service.enabled`, `persistence.enabled`, `config.inline`, and `serviceAccount.create`.
- [x] Preserve operational object settings, but add validation that rejects object settings that make
  a core service unusable.

## T04: Remove first-class service gates

- [x] Remove service-level gates from bootstrap templates and make bootstrap always render.
- [x] Remove gates from Temporal templates so schema/bootstrap jobs, role Deployments, Services,
  NetworkPolicy, and Temporal web always render.
- [x] Remove MCP `mcp.enabled` gates and always render MCP RBAC/NetworkPolicy.
- [x] Remove observability/Grafana and core SeaweedFS/DocumentDB helper service gates while keeping
  nested operational gates such as NetworkPolicy, TLS, and logical replication.
- [x] Remove route filtering that hides executor-required routes when the executor is disabled; the
  executor is always the data-plane upstream.

## T05: Make generated platform credentials self-contained

- [x] Replace the manual `tests/live-campaign/make-secrets.sh` requirement with chart/OpenBao/ESO
  generated non-placeholder credentials that are stable across upgrades.
- [x] Seed OpenBao platform paths for PostgreSQL, pgvector, DocumentDB, FerretDB, DocumentDB
  replication, Kafka, S3/storage, Keycloak admin, identity client, superadmin, APISIX admin, gateway
  shared secret, Temporal credentials if secret-sourced, and workspace-secret backend auth.
- [x] Update ESO ExternalSecrets to target the actual Secret names and keys consumed by workloads, or
  update workload values to consume the ESO target names. Do not leave unused synced credentials.
- [x] Ensure OpenBao init and migration never log generated secrets, unseal keys, or root tokens.

## T06: Wire newly core runtimes in base values/templates

- [x] Dedicated pgvector: deploy by default with generated `in-falcone-postgresql-vector` credentials,
  Service, PVC, and vector extension smoke coverage.
- [x] Control-plane executor: add complete base env for upstream control-plane, PG, FerretDB, Kafka,
  Temporal, MCP, and gateway shared-secret trust; add resources and Helm-owned Service/RBAC.
- [x] Workflow worker: add base Temporal and PostgreSQL env; keep `/readyz` tied to Temporal polling.
- [x] OpenBao workspace secrets: make the default control-plane workspace-secret client authenticate
  to OpenBao, preferably via Kubernetes auth when `BAO_TOKEN` is absent.
- [x] Temporal: make persistence host release-aware, keep internal-only ClusterIP services, and
  register namespace/search attributes.
- [ ] MCP: set `MCP_ENABLED=true`, configure a real runtime image/digest, bind RBAC to the serving
  runtime ServiceAccount, and replace core in-memory MCP state with PostgreSQL-backed persistence.

## T07: Update schema and validators

- [x] Update `charts/in-falcone/values.schema.json` to declare every core service contract and remove
  root service `enabled` requirements.
- [x] Reject stale service-disable overrides in values files, while allowing classified operational
  flags such as NetworkPolicy, persistence mode, TLS mode, and unused upstream SeaweedFS roles.
- [x] Update `scripts/lib/deployment-chart.mjs`, `deployment-topology.mjs`, quality gates, and related
  validator fixtures so CI expects all-core services and no partial-service escape hatches.

## T08: Update overlays, profiles, and install scripts

- [x] Remove `bootstrap.enabled=false` and two-phase bootstrap toggling from kind/live-campaign flows.
- [x] Remove OpenBao, ESO, Temporal, MCP, pgvector, executor, worker, and observability service-disable
  overrides from shipped profiles/overlays.
- [x] Fold the current advanced/vault/vector kind overlays into the base kind install or leave them as
  no-op compatibility overlays that do not enable services.
- [x] Remove out-of-band executor application from `tests/live-campaign/install.sh`; Helm owns it.
- [x] Update OpenShift values/comments to provide all-core security/storage/TLS overrides rather than
  documenting missing OpenBao/ESO/Temporal prerequisites.

## T09: Existing-install migration and rollback

- [x] Add backup tooling under `loop-state/system-changes/make-all-services-core/` for K8s Secrets,
  external Vault/OpenBao KV data, Helm values/manifests/history, ESO ownership, and PVC inventory.
- [x] Add idempotent migration tooling that copies K8s Secret and Vault data into OpenBao, preserves
  encryption keys byte-identically, materializes ESO targets, and verifies checksums.
- [x] Add rollback tooling that restores the prior Helm revision and backed-up Secrets without
  deleting OpenBao, pgvector, Temporal, or existing service PVCs.
- [x] Document ESO ownership conflict handling and external Vault coexistence/decommission boundaries.

## T10: Tests

- [x] Update render tests that currently assert default-off behavior for OpenBao/ESO, Temporal,
  workflow worker, control-plane executor, MCP, and pgvector.
- [x] Add static tests for no dependency conditions and no core service disable keys.
- [ ] Add fresh-install readiness checks for every Deployment, StatefulSet, Job, ClusterSecretStore,
  ExternalSecret, OpenBao health, Temporal namespace/search attributes, pgvector extension, workspace
  secrets, flows routes, MCP routes, and Prometheus scrape targets listed in `design.md`.
- [x] Add tenant-isolation regression tests for workspace secrets, flows, and MCP after the runtime
  gates become default-active.

## T11: Docs and operator behavior

- [x] Update values documentation to state that platform services are core and cannot be disabled.
- [x] Document preserved operational flags and the reason unused upstream SeaweedFS roles remain off.
- [x] Document the new baseline resource footprint.
- [x] Document existing-install backup, migration, rollout, health gates, PVC retention, and rollback.

## T12: Fresh-install evidence and review handoff

- [ ] Run a clean install on the test cluster or a clean namespace from the branch.
- [ ] Capture the exact readiness assertions and smoke outputs required by `design.md`.
- [ ] Hand the implementation diff, migration artifacts, and fresh-install evidence to
  `system-reviewer` and `devops-engineer`.

## Implementation notes

- Baseline: `corepack` is not installed in this environment; commands were run with `pnpm`.
- Baseline before edits: `pnpm validate:repo`, `openspec validate make-all-services-core --strict`,
  and `helm lint charts/in-falcone` passed. `pnpm lint:md` failed only on existing
  `README-loop-kit.md` formatting, and `pnpm lint:snippets` failed because
  `docs/guides/realtime/frontend-quickstart.md` is missing.
- Verification after edits: `pnpm validate:repo`, `openspec validate make-all-services-core --strict`,
  `helm lint charts/in-falcone`, `helm template falcone charts/in-falcone --namespace falcone
  --include-crds`, targeted MCP/unit/topology tests, and targeted MCP blackbox tests passed.
- Full `pnpm test:unit` now has 854 passing tests and 3 remaining dependency failures:
  missing `jose` for backup-status and missing `@temporalio/activity` for flow activity tests.
- Fresh clean-cluster install was intentionally not run in this implementer stage per orchestrator
  instruction.
- MCP runtime wiring and PostgreSQL-backed MCP state are implemented, but the configured
  `ghcr.io/gntik-ai/in-falcone-mcp-runtime:0.1.0` manifest could not be verified from this
  environment (`manifest unknown`), so the real published runtime image/digest remains open.
