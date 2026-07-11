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
  RBAC is bound to the Helm-owned executor ServiceAccount and MCP registry/audit/rate state now
  writes through a row-locked PostgreSQL store; the verified public runtime image/digest remains
  blocked on image publication.

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

- [x] Add tracked backup tooling under `scripts/system-changes/make-all-services-core/` for K8s
  Secrets/OpenBao KV parity and restricted KV backup archives.
- [x] Add idempotent migration tooling that copies K8s Secret and Vault data into OpenBao, preserves
  encryption keys byte-identically, materializes ESO targets, and verifies checksums.
- [x] Add rollback tooling that restores backed-up OpenBao KV data before the operator rolls back the
  Helm release, without deleting OpenBao, pgvector, Temporal, or existing service PVCs.
- [x] Document ESO ownership conflict handling and external Vault coexistence/decommission boundaries.

## T10: Tests

- [x] Update render tests that currently assert default-off behavior for OpenBao/ESO, Temporal,
  workflow worker, control-plane executor, MCP, and pgvector.
- [x] Add static tests for no dependency conditions and no core service disable keys.
- [ ] Add fresh-install readiness checks for every Deployment, StatefulSet, Job, ClusterSecretStore,
  ExternalSecret, OpenBao health, Temporal namespace/search attributes, pgvector extension, workspace
  secrets, flows routes, MCP routes, and Prometheus scrape targets listed in `design.md`.
  Static Helm readiness coverage was added for namespace consistency, disable-path failures,
  OpenBao/ESO mappings, Temporal DB bootstrap, MCP route/RBAC, and local kind image overrides; actual
  cluster readiness evidence is still not captured.
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
- Verification after edits in the original implementation: `pnpm validate:repo`, `openspec validate
  make-all-services-core --strict`, `helm lint charts/in-falcone`, `helm template falcone
  charts/in-falcone --namespace falcone --include-crds`, targeted MCP/unit/topology tests, and
  targeted MCP blackbox tests passed.
- Reviewer-revision coverage added static tests for arbitrary release namespaces, all core disable
  paths, nested `service.enabled=false`, OpenBao/ESO credential parity, Temporal DB bootstrap, MCP
  route/RBAC, local kind image overrides, ESO ownership preflight behavior, public API family
  routing/catalog alignment, and MCP PostgreSQL transaction safety.
- Reviewer-revision validation run: `helm dependency build charts/in-falcone`; `helm template
  falcone charts/in-falcone --namespace arbitrary-ns --include-crds`; `helm lint
  charts/in-falcone --namespace arbitrary-ns`; `bash -n
  scripts/system-changes/make-all-services-core/*.sh`; targeted `node --test` suite covering 86
  MCP/chart/gateway/readiness tests; `openspec validate make-all-services-core --strict`;
  `npm run validate:repo`; `git diff --check`.
- Second-reviewer revision fixed the remaining static blockers without applying to a cluster:
  default third-party images now render verified `bitnamilegacy` tags, default unpublished
  project-owned runtime images render local buildable aliases, OpenBao recovery only writes the
  recovery Secret when root-token material is present, OpenBao/ESO auth honors a configured ESO
  namespace, ESO syncs `in-falcone-documentdb-replication/realtime-url`, and existing-install
  backup/migration/restore scripts now require verified backups, compare destination fingerprints,
  fail closed on overwrite, restore Kubernetes Secrets/ESO resources, and can execute a
  release-name-safe Helm rollback.
- Second-reviewer validation run: `bash -n scripts/system-changes/make-all-services-core/*.sh`;
  `helm dependency build charts/in-falcone`; `helm template falcone charts/in-falcone --namespace
  review-ns --include-crds`;
  `helm template falcone charts/in-falcone --namespace review-ns --set
  eso.eso.namespace=custom-eso --set openbao.eso.namespace=custom-eso`; `helm lint
  charts/in-falcone --namespace review-ns`; `docker manifest inspect` for
  `docker.io/bitnamilegacy/postgresql:17.2.0`, `docker.io/bitnamilegacy/kafka:3.9.0`,
  `docker.io/alpine/k8s:1.32.2`, `docker.io/pgvector/pgvector:pg17`, and
  `docker.io/pgvector/pgvector@sha256:815bf5378222044da3b34d98e6a5fdac37b15c428b67d09c7c2d90a038e597bf`;
  `node --test tests/blackbox/all-core-install-readiness.test.mjs`; focused `node --test`
  coverage for pgvector, OpenBao/ESO, kind advanced profile, Prometheus completeness, and Temporal
  Secret substitution; `openspec validate make-all-services-core --strict`;
  `npm run validate:repo`; `git diff --check`. `npm run lint:md` and `npm run lint:snippets`
  still fail only on the pre-existing `README-loop-kit.md` formatting issues and missing
  `docs/guides/realtime/frontend-quickstart.md` recorded above.
- Third-reviewer revision addressed the remaining fresh-install contract blockers without applying
  to a cluster: default APISIX and Prometheus refs now use verified pullable tags
  `docker.io/apache/apisix:3.10.0-debian` and the Prometheus v3.2.1 manifest digest
  `sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62`; base
  first-party images no longer render `localhost` and use the coherent chart app-version release tag
  `0.3.0`; the release workflow now includes a tracked production MCP runtime image build; the ESO
  wrapper vendors the upstream `external-secrets` dependency and renders controller, webhook,
  cert-controller, and CRDs; the umbrella chart creates/adopts configured auxiliary namespaces;
  default Kafka is a valid single-broker KRaft topology; OpenBao init and migration write KV paths
  with merge semantics and merge external source KV backup data before mapped Kubernetes Secret
  overlays; backup works before target OpenBao exists, refuses existing output archives, and records
  target KV as absent when credentials are not supplied; `diff-rollout.sh` adds a read-only
  Helm/kubectl rollout diff gate.
- Third-reviewer validation added focused regressions for nested ESO dependency/controller render,
  auxiliary namespaces, pullable base refs/no localhost defaults, Kafka single-broker defaults,
  KV merge/non-clobber helpers, target-absent backup/output refusal, and the rollout diff gate.
- Fourth-reviewer revision fixed the remaining code blockers without publishing images or touching a
  cluster: OpenBao/ESO namespace-derived addresses, cert SANs, ESO operator namespace topology, ESO
  NetworkPolicy, control-plane/executor `BAO_ADDR`, and MCP runtime image env now render from chart
  values; the hosted MCP JSON-RPC path now enforces the caller's actual scopes for mutating hosted
  tools and does not self-grant tool scopes; the ESO wrapper's unpacked external-secrets dependency
  has a nested lock/provenance note.
- Fourth-reviewer validation run: `helm dependency build charts/in-falcone`; `helm lint
  charts/in-falcone --namespace review-ns`; default `helm template ... --include-crds`; custom
  namespace `helm template ... --set eso.eso.namespace=custom-eso --set
  eso.external-secrets.namespaceOverride=custom-eso --set openbao.eso.namespace=custom-eso --set
  openbao.openbao.namespace=custom-store --set eso.eso.caProvider.namespace=custom-store`; mismatch
  namespace render failed closed as expected; focused MCP tests including the new negative hosted
  JSON-RPC write-scope regression; `node --test tests/blackbox/all-core-install-readiness.test.mjs`;
  `openspec validate make-all-services-core --strict`; `npm run validate:repo`; `git diff --check`.
- Fresh clean-cluster install was intentionally not run in this implementer stage per orchestrator
  instruction.
- GHCR publication of the coherent first-party `0.3.0` image set succeeded via GitHub Actions run
  `29150940923` for:
  `ghcr.io/gntik-ai/in-falcone-control-plane:0.3.0`,
  `ghcr.io/gntik-ai/in-falcone-control-plane-executor:0.3.0`,
  `ghcr.io/gntik-ai/in-falcone-workflow-worker:0.3.0`,
  `ghcr.io/gntik-ai/in-falcone-mcp-runtime:0.3.0`, and
  `ghcr.io/gntik-ai/in-falcone-web-console:0.3.0`.
- Digest pinning and final release evidence remain intentionally unchecked until the clean
  fresh-cluster install records the exact manifests deployed from this branch.
