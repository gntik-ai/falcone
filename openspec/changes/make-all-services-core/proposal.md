# Make all platform services core

## Why

Falcone currently supports unsupported partial platform installs through a mix of Helm dependency
`condition:` gates, top-level service `enabled` values, template branches, install overlays, and
runtime env gates. A fresh install can omit dedicated pgvector, the control-plane executor, the
workflow worker, ESO, OpenBao, Temporal, and MCP; some shipped profiles also disable bootstrap or
observability. That makes "what is Falcone?" ambiguous, leaves code paths defending against missing
platform dependencies, and makes fresh-install evidence weaker than the product contract.

This change makes Falcone a single coherent platform: every fresh install provisions and wires every
Falcone-owned platform service by default, with no supported per-service disable path.

## What Changes

- **Install source of truth:** remove all platform-service `condition:` entries from
  `charts/in-falcone/Chart.yaml`; remove top-level service `enabled` keys from base values, overlays,
  profiles, and schemas; remove service-level render gates from the component-wrapper and first-class
  templates. Operational flags such as NetworkPolicy, persistence mode, TLS mode, probes, resources,
  and unused upstream SeaweedFS roles remain configurable.
- **Core baseline wiring:** make base values/templates wire dedicated pgvector, the control-plane
  executor, workflow worker, ESO, OpenBao, Temporal, MCP, and bootstrap so they are usable on a fresh
  install. This includes executor data-plane env, Temporal env, worker env, MCP env, OpenBao workspace
  secret auth, generated platform credentials, and actual ESO target Secrets consumed by workloads.
- **Bootstrap and initialization:** bootstrap always renders and remains idempotent. OpenBao init,
  Temporal schema/bootstrap, DocumentDB init, SeaweedFS helpers, APISIX route rendering, and platform
  credential seeding converge without a two-phase "disable bootstrap then enable it" install.
- **Runtime behavior:** flows routes, MCP routes, and workspace secrets are active in the default
  runtime because their backing services and env are present. The executor is Helm-owned rather than
  applied out of band.
- **Validation and tests:** schema, chart validators, render tests, blackbox tests, install scripts,
  and docs are updated to reject service-disable overrides and to prove a fresh all-core install.
- **Existing-install transition:** provide a backup, migration, rollout, verification, and rollback
  plan for clusters that already have manual Kubernetes Secrets, external Vault/OpenBao state, an
  external ESO owner, disabled-service overrides, or PVCs from older revisions.

## Capabilities

### New Capabilities

- `platform-services`: defines the deployment contract for Falcone-owned platform services as a
  complete, non-optional baseline.

### Modified Capabilities

- `deployment`: the Helm chart, install profiles, upgrade behavior, validation scripts, and install
  evidence now represent a complete platform install rather than a partial-service matrix.
- `secrets`: OpenBao and ESO are always installed and wired for workspace/platform secrets on fresh
  installs.
- `workflows`: Temporal and the workflow worker are always installed and wired.
- `mcp`: MCP routes/RBAC/network policy and durable state are always available in the runtime serving
  MCP.
- `vector-search`: dedicated pgvector PostgreSQL is always installed.

## Impact

- **Chart dependencies:** `charts/in-falcone/Chart.yaml`, `Chart.lock`, packaged dependency archives.
- **Generic wrapper:** `charts/in-falcone/charts/component-wrapper/templates/*` and its schema.
- **Umbrella values/schema:** `charts/in-falcone/values.yaml`, `values.schema.json`, profiles, platform
  overlays, and deployment/kind/OpenShift values.
- **First-class templates:** bootstrap, runtime config maps, APISIX route payloads, control-plane RBAC,
  DocumentDB helpers, observability/Grafana, SeaweedFS helpers, Temporal, MCP, validation.
- **OpenBao/ESO:** subchart values/templates for init, credential seeding, ExternalSecret targets,
  ownership conflict behavior, and fresh-install readiness.
- **Runtime config/code:** executor, workflow worker, OpenBao workspace secrets auth, MCP durable state,
  and any abstraction-layer updates needed to make the default runtime active without optional env.
- **Install scripts:** live campaign and kind/OpenShift flows stop setting service disables or applying
  the executor out of band.
- **Tests/docs:** render tests invert optional-service expectations; fresh-install tests assert all
  services Ready; docs explain sizing, migration, and that services are no longer optional.

## Non-Goals

- Enabling unused upstream SeaweedFS roles such as SFTP, admin, worker, COSI, or allInOne.
- Turning operational knobs into constants. TLS mode, NetworkPolicy emission, persistence sizing,
  replica counts, images, pull secrets, and platform target settings remain configurable.
- Automatically rolling out to production. Existing-cluster rollout is gated and test-cluster first.
- Decommissioning an external Vault or external ESO after migration. Decommission is a later,
  separately approved operator action.

## Risks

- **Breaking upgrades:** old values files may still contain `*.enabled=false`. The chart must reject
  those as stale unsupported overrides rather than silently rendering a partial system.
- **Resource footprint:** default installs add pgvector, OpenBao, ESO, Temporal, workflow worker, the
  executor, MCP durable state, and observability in all profiles.
- **Credential drift:** generated platform Secrets, OpenBao KV paths, and ESO targets can diverge if
  ownership is unclear. The implementation must define one canonical path and verify checksums.
- **Secret exposure:** OpenBao init/unseal and migration must not log root tokens, unseal keys, or
  generated credentials.
- **ESO ownership conflicts:** clusters with a pre-existing cluster-wide ESO need adoption or
  coordinated decommission, not a second unmanaged controller.
- **Data loss on rollback:** rollback must not delete OpenBao, pgvector, Temporal, or existing service
  PVCs.
- **Runtime routes without backing state:** flows, MCP, and secrets must be proven active, not merely
  rendered.

## Exit Criteria

- A clean install from the branch, with default values plus only environment/platform sizing overrides,
  brings every core service Ready and passes the readiness assertions in `design.md`.
- Render and schema checks prove no service-level disable switches or dependency conditions remain.
- Existing-install migration and rollback artifacts exist and are documented.
- Reviewer/devops evidence confirms tenant isolation, secret confidentiality, PVC retention, and
  source-of-truth ownership.
