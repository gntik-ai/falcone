# Architecture Decision Records

The significant architectural decisions visible in the codebase, captured as short records. Each states the decision, why, and where it shows up in code.

## ADR-1 — Shared database with Row-Level Security for tenant isolation

**Decision.** Use a shared database, tenant-scoped model. In PostgreSQL, enforce isolation with **Row-Level Security** plus a dedicated **non-`BYPASSRLS` application role** (`falcone_app`, with `anon`/`service` variants); in MongoDB, enforce it with an adapter-injected `tenantId` predicate.

**Why.** RLS makes isolation a property of the *database*, not just the application — a forgotten `WHERE tenant_id = …` is still constrained. Using a non-superuser role is essential because RLS does not apply to superusers/`BYPASSRLS` roles.

**Evidence.** `docs/reference/postgresql/tenant-isolation-baseline.sql`; executor `SET LOCAL ROLE`; `services/adapters/src/*`.

## ADR-2 — Credential-derived tenant; fail closed

**Decision.** The tenant/workspace are derived from a **verified credential** in strict precedence (API key → Bearer JWT → gateway-injected headers). A presented-but-invalid credential returns `401` and never falls back to client-supplied headers.

**Why.** Trusting a client-supplied `x-tenant-id` is a spoofing vector (a real bug, since fixed). Deriving identity from the credential makes spoofing impossible by construction.

**Evidence.** `apps/control-plane/src/runtime/server.mjs::resolveIdentity`.

## ADR-3 — Single gateway, two privilege domains

**Decision.** Front the whole platform with APISIX and split routes into `structural_admin` and `data_access`, enforced by a scope plugin. Route anon/service traffic by the `apikey` header.

**Why.** One ingress simplifies clients and TLS; domain separation keeps the management plane unreachable from data-plane credentials.

**Evidence.** `services/gateway-config/public-route-catalog.json`; scope-enforcement plugin + specs.

## ADR-4 — Executor over adapter-built plans

**Decision.** Separate **plan building** (adapters, pure functions) from **plan execution** (a dependency-light executor running real drivers).

**Why.** Plan builders are testable without a database and concentrate the tenant predicate in one place; the executor stays small and driver-focused.

**Evidence.** `services/adapters/src/*` (`build*Plan`) → `apps/control-plane/src/runtime/*-executor.mjs`.

## ADR-5 — Supabase-style anon/service API keys

**Decision.** Offer `flc_anon_…` (read-mostly, browser-safe, RLS-bound) and `flc_service_…` (server-side, elevated) keys, transported via the `apikey` header (and `?apikey=` for SSE).

**Why.** Lets frontends talk to the platform directly without a backend, while keeping privileged access server-side. Anon keys bind to a constrained DB role so RLS still applies.

**Evidence.** `api-keys.mjs`; gateway `vars` on `^flc_`.

## ADR-6 — Realtime over SSE, tenant-scoped at the source

**Decision.** Deliver realtime via **Server-Sent Events** (no WebSocket dependency), sourced from MongoDB change streams and PostgreSQL trigger CDC, with tenant matching done **inside** the pipeline/channel.

**Why.** SSE is simple and proxy-friendly; matching the tenant at the source guarantees a subscriber cannot receive another tenant's changes even if routing is wrong. EventSource can't set headers, so SSE accepts `?apikey=`.

**Evidence.** `realtime-executor.mjs`, `postgres-realtime-executor.mjs`.

## ADR-7 — Per-key rate limiting with explicit policy

**Decision.** Rate-limit with APISIX `limit-count` keyed by `var_combination` on `$http_apikey` (per-key buckets), with a choice of `local` (node-local) or `redis` (globally exact) policy.

**Why.** A plain `var` key rate-limits globally across keys (a real bug, caught by live testing). `var_combination` isolates each key; the policy choice trades exactness for a Redis dependency.

**Evidence.** `scripts/lib/gateway-policy.mjs`; gateway route config.

## ADR-8 — Umbrella Helm chart with layered values

**Decision.** Package everything as one umbrella chart of toggleable `component-wrapper` dependencies, configured by layered values (environment → customer → platform → airgap → local) and sizing profiles (all-in-one / standard / ha).

**Why.** One artifact serves dev, Kubernetes, OpenShift and air-gapped installs; layering keeps environment/customer/platform concerns separable and reviewable.

**Evidence.** `charts/in-falcone/Chart.yaml`, `values/`, `templates/NOTES.txt`.

## ADR-9 — Secrets via Vault + External Secrets Operator

**Decision.** Source secrets from Vault through the External Secrets Operator; reference secret *names* in the chart, never values.

**Why.** Keeps secret material out of git and values files; integrates with existing secret stores.

**Evidence.** chart `eso`/`vault` sections; `secretKeyRef` mounts.

## ADR-10 — Soft-delete lifecycle for cascading cleanup

**Decision.** Govern entities with a `draft → active → suspended → soft_deleted` lifecycle.

**Why.** Soft deletion lets the platform deprovision tenants/workspaces and cascade resource cleanup while preserving audit history and avoiding orphaned cross-tenant data.

**Evidence.** `services/internal-contracts/src/domain-model.json` (`lifecycle_transitions`).

## ADR-11 — Temporal for the durable workflow (flows) engine

**Decision.** Adopt **Temporal** as the durable execution engine for the flows capability, using the **TypeScript SDK** (`@temporalio/{worker,workflow,activity,client}`). Flows are authored as a **YAML DSL** interpreted by a single generic interpreter workflow; the parsed definition is **passed as workflow input** (definition-passing strategy), not loaded per-replay. Branch conditions are evaluated by the **CEL expression engine** (`cel-js`). Tenancy uses a **shared namespace with a `tenantId` custom search attribute** (not namespace-per-tenant). Run-history visibility is served by Temporal's **PostgreSQL SQL advanced-visibility store — no Elasticsearch**. Temporal itself is **internal-only**, and its Web UI is **operator-only** (never exposed to tenants).

**Why.**
- *Adoption rationale.* Temporal gives **durable execution** (workflow state survives process/worker crashes via event-sourced history replay), **millisecond task dispatch** via task-queue long-polling, native **namespaces** for multi-environment/multi-tenant partitioning, and is **MIT-licensed** (no commercial-license risk for self-hosted install). The trade-off accepted is that Temporal is **code-first**, so flows are wrapped in a **YAML DSL + a generic interpreter workflow** to give product/console users a declarative authoring surface over the code-first engine.
- *SDK = TypeScript.* The entire backend is Node — there is **no non-Node backend language** in `apps/` or `services/`. Evidence: `apps/control-plane/Dockerfile` builds `FROM node:22-alpine`; `apps/control-plane/package.json` declares `"type":"module"` (Node ESM); every service under `services/` ships `.mjs` modules with `"type":"module"`. The TypeScript SDK is the only first-class fit; introducing another language solely for flows would fragment the stack.
- *Tenancy = shared namespace + `tenantId` search attribute.* Spike B measured both models at N = {1, 5, 20} tenants. Namespace-per-tenant scales pollers linearly (4 → 20 → 80) and gRPC connections super-linearly (4 → 60 → 840 total), an operational ceiling that worsens per tenant. The shared model holds fleet topology **flat at 4 pollers / 4 connections** for all N, and the `tenantId` filter isolates run history with zero leakage. The flat profile and low operational complexity win; the soft isolation boundary is enforced by mandating the `tenantId` filter on every visibility query.
- *Definition-passing = workflow input.* Spike A confirmed the full parsed definition is recorded in the `WorkflowExecutionStarted` history event, making replay deterministic with no external lookup; the SDK replayer re-ran the history with no non-determinism error.
- *Expression engine = CEL.* Spike A bundled and ran both `cel-js` and `jsonata` inside the Temporal V8 workflow sandbox — both survived and evaluated deterministically. CEL is chosen for its semantic fit (purpose-built side-effect-free boolean condition language); JSONata is the validated fallback. The measured bundle trade-off (CEL ~2.17 MB vs JSONata ~0.74 MB delta) is a one-time worker-image cost.
- *Visibility = PostgreSQL SQL, sufficient.* Spike B ran `tenantId`-filtered visibility queries against the **PostgreSQL** advanced-visibility store and observed zero cross-tenant leakage at N up to 20, establishing that **PostgreSQL SQL visibility is sufficient and Elasticsearch is not required** at this tier.
- *UI stance.* Temporal is an **internal-only** dependency; its Web UI is **operator-only** and never reachable by tenant credentials — flow authoring/inspection for tenants happens through the Falcone console/API, consistent with the structural_admin / data_access split (ADR-3).

**Evidence.** SDK: `apps/control-plane/Dockerfile` (`FROM node:22-alpine`), `apps/control-plane/package.json` (`"type":"module"`), `services/*/package.json` (`"type":"module"`, `.mjs`). Spikes: `spikes/add-flows-adr-temporal-spikes/spike-a/` (durable resume, retry-across-restart, replay determinism, `expression-engines.md`) and `spikes/add-flows-adr-temporal-spikes/spike-b/` (`measurements.md`, `comparison-table.md`, PostgreSQL SQL-visibility proof).
