<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>A multitenant Backend-as-a-Service (BaaS) platform.</strong>

  <p>Databases, storage, auth, events, realtime and serverless functions — isolated per tenant, governed by plans and quotas, behind one API.</p>

  <p>
    <img alt="Status: early development" src="https://img.shields.io/badge/status-early%20development-orange" />
    <img alt="Not production ready" src="https://img.shields.io/badge/production-not%20ready-critical" />
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" />
  </p>

  <sub>

  **English** ·
  [Español](./README.es.md) ·
  [Français](./README.fr.md) ·
  [Deutsch](./README.de.md) ·
  [中文](./README.zh.md) ·
  [Русский](./README.ru.md)

  </sub>
</div>

---

> [!WARNING]
> **Falcone is not production-ready.** It is in early, active development.
> Public APIs, data schemas, and runtime behavior may change at any time, without notice or a
> migration path. There are **no stability, security, or support guarantees** at this stage, and
> the project has not undergone a security audit.
> **Do not run Falcone for production workloads or entrust it with sensitive data.** Use it for
> evaluation, experimentation, and development only.

---

## The principle behind Falcone

Most products need the same backend plumbing: a database, file storage, user
authentication, background jobs, an event bus, realtime updates. Building and
operating that plumbing **once per application — and again for every customer —**
is where teams lose time and where security incidents are born.

Falcone exists to solve that once. It is a **multitenant BaaS**: a single
platform that serves many isolated tenants, each with their own data, identities
and resources, exposed through one consistent API.

Two ideas hold the whole system together:

1. **Tenant isolation is the contract, not a feature.**
   Every read and every write is scoped by `tenant_id` (and, one level down, by
   `workspace_id`). Identity is resolved at the edge from a token, propagated as
   an explicit context through the gateway, services, the data layer and
   background jobs, and enforced at the database with row-level security and
   per-tenant schemas. Cross-tenant leakage is treated as the cardinal bug.

2. **Capabilities are granted by plan, enforced everywhere.**
   What a tenant can do — SQL, realtime, webhooks, functions, Kafka, storage — is
   the intersection of its **commercial plan**, the **deployment profile** and the
   **environment**. The gateway gates routes on those capability keys, quotas cap
   consumption per tenant/workspace, and every denial is audited.

The result is a platform where a customer gets a full backend in minutes, and the
operator keeps a single, governable, observable surface — instead of a fleet of
hand-rolled backends.

### How it fits together

```
                        ┌──────────────────────────────────────────┐
   Bearer JWT  ──▶  API Gateway (APISIX)   /v1   idempotency, CORS, │
                    resolve tenant ▸ inject identity, correlation-id │
                        └───────────────┬──────────────────────────┘
                                        ▼
                        ┌──────────────────────────────────────────┐
                        │ control-plane  — 249+ REST endpoints      │
                        │ tenants · workspaces · auth/IAM · pg ·    │
                        │ mongo · storage · events · functions ·    │
                        │ metrics · plans · quotas · backup         │
                        └───────────────┬──────────────────────────┘
            ┌───────────────────────────┼─────────────────────────────┐
            ▼                           ▼                             ▼
   provisioning-orchestrator   realtime-gateway / webhook-engine   cdc-bridges
   (sagas, appliers)           scheduling-engine / backup-status   (pg & mongo → Kafka)
            │                           │                             │
            ▼                           ▼                             ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL (RLS + schema-per-tenant) · MongoDB · Kafka · S3/MinIO ·      │
   │ Vault (secrets) · Keycloak (realm-per-tenant IAM)                        │
   └────────────────────────────────────────────────────────────────────────┘
```

The platform is a **pnpm + Turbo monorepo** of Node.js (ES module) services and a
React + Vite web console, deployed with Helm on Kubernetes and fronted by an
APISIX gateway.

---

## Built for AI: a BaAIS

Falcone begins where any backend platform does — multitenant data, auth, storage, events and
functions behind one API — and aims it at how software is increasingly built and operated:
**by, and for, AI agents.**

We call this category a **BaAIS** — a *Backend-as-an-AI-Service*, a play on "BaaS" for an
AI-native world. (The expansion is intentionally loose; what matters is the direction, not the
acronym.) Concretely, "built for AI" means a tenant's backend is designed to be **natively
consumable by agents**, not only by application code:

- **MCP server hosting** *(in development)* — tenants will expose their backend (data, storage,
  functions) as a [Model Context Protocol](https://modelcontextprotocol.io) server, so any
  MCP-capable agent can discover and call it under that tenant's own isolation, auth and quotas.
- **Agentic workflows** — the Temporal-based **Flows** engine lets tenants define durable,
  multi-step workflows from a JSON-Schema DSL, with a first-party activity catalog whose
  credentials are tenant-scoped — the reliable substrate an agent needs to act across services.

Everything an agent touches stays inside the same contract as the rest of the platform: scoped by
tenant and workspace, gated by plan capabilities, and audited.

---

## Roadmap

Falcone is pre-1.0 and moving quickly; this is near-term direction, not a commitment.

- **MCP server hosting** — *in active development.* Let tenants expose and host
  [Model Context Protocol](https://modelcontextprotocol.io) servers so their backends are
  reachable by AI agents, under per-tenant isolation, authentication and quotas.
- **Flows — durable workflow engine (Temporal)** — *in progress* ([epic #355](https://github.com/gntik-ai/falcone/issues/355)).
  Tenant-defined workflows via a JSON-Schema DSL and interpreter worker, a first-party activity
  catalog with tenant-scoped credentials, triggers (Temporal Schedules, webhooks, platform
  events) and a visual designer in the web console.
- **Toward a first stable release** — *planned.* Security review, API/schema stability
  guarantees, and migration tooling (see the notice at the top).

---

## Capabilities

| Domain | What it gives a tenant |
| --- | --- |
| **Tenant lifecycle** | Create, suspend, soft-delete and purge tenants through a guarded state machine (`draft → provisioning → active → suspended → soft_deleted`), with governance dashboards and dual-confirmation on destructive actions. |
| **Provisioning saga** | Asynchronous orchestration that stands up (or tears down) a tenant across every domain — IAM realm, Kafka namespace, Postgres schema, MongoDB, storage namespace, functions namespace — with preflight checks and rollback on failure. |
| **Workspaces** | Sub-tenant boundaries with their own slug, environment, IAM scope and membership. Clone workspaces with explicit policies; resolve shared vs. specialized resource inheritance. |
| **Authentication & IAM** | OIDC-delegated console login, signup with pending-activation, password recovery. Keycloak realm-per-tenant administration of realms, clients, roles, scopes and users. JWT validation via cached JWKS with introspection fallback. |
| **Service accounts & OAuth2 apps** | Per-workspace OAuth2 clients and API-key service accounts with HTTPS redirect-URI validation and plan-enforced limits. |
| **PostgreSQL** | Tenant-scoped data API plus admin/governance, change-data-capture, metrics and audit. Isolation by row-level security (`app.tenant_id` / `app.workspace_id`) and per-tenant schemas. |
| **MongoDB** | Per-tenant/workspace document data API, admin, change streams, metrics and audit. |
| **Object storage** | S3-compatible buckets, multipart uploads, presigned URLs, access policies, event notifications and per-tenant capacity quotas. |
| **Events (Kafka)** | Topic management and tenant-scoped CDC change streams (`<prefix>.<tenant>.<workspace>`), plus system audit/quota/lifecycle topics. |
| **Realtime** | WebSocket subscriptions (`/v1/websockets`) with Bearer-JWT auth, scope-to-channel enforcement and per-session tenant isolation. |
| **Functions** | Serverless functions with versions, activations, invocations, rollback and cron / Kafka / storage triggers. |
| **Webhooks** | Signed, retried webhook delivery with SSRF guarding (private, loopback, link-local and ULA ranges blocked, re-checked at delivery time). |
| **Scheduling** | Cron jobs with per-workspace concurrency and job-count quotas and full execution audit. |
| **Flows (workflow engine)** | Tenant-defined durable workflows on a Temporal-based engine: a JSON-Schema DSL and interpreter worker, a first-party activity catalog with tenant-scoped credentials, triggers (schedules, webhooks, platform events) and a visual designer in the console. *In active development ([epic #355](https://github.com/gntik-ai/falcone/issues/355)).* |
| **Plans & quotas** | Commercial plans map to capability keys, quota defaults and a deployment profile. Quotas enforce hard-block / soft-grace / soft-exhausted modes per tenant and workspace. |
| **Backup & restore** | Snapshot listing, restore orchestration and point-in-time-recovery simulation over S3 / Postgres / Mongo adapters. |
| **Observability & audit** | Per-tenant audit pipeline (actor, scope envelope, resource, action, result) streamed to Kafka and persisted, with metrics families, health checks, dashboards and threshold alerts. |
| **API gateway** | Single public surface at `/v1` with required idempotency keys, correlation IDs, request validation and per-route timeouts/retries. |
| **Web console** | React + Vite admin UI for tenants, workspaces, members, databases, storage, functions, events, plans, quotas and observability. |

---

## QuickStart with Docker Compose

The repository ships a Compose stack that brings up the **real backing services**
Falcone talks to — PostgreSQL, Keycloak, Redpanda (Kafka), MongoDB (single-node
replica set), MinIO (S3) and Vault — plus an APISIX gateway and an action runner.
This is the fastest way to get a working environment on your machine.

### Prerequisites

- Docker with the Compose plugin (`docker compose`)
- Node.js 20+ and `pnpm` (via `corepack enable`) — only needed to run the suites

### 1. Clone and install

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone
corepack enable
pnpm install
```

### 2. Bring up the stack with Docker Compose

The helper script wires up health checks, migrations, the Mongo replica set, the
MinIO bucket and the Vault audit device for you:

```bash
cd tests/env
./up.sh
```

…or drive Compose directly if you only want the containers:

```bash
docker compose -f tests/env/docker-compose.yml up -d --build
docker compose -f tests/env/docker-compose.yml ps
```

### 3. Services and ports

| Service | URL / endpoint | Credentials |
| --- | --- | --- |
| API gateway (APISIX) | http://localhost:9080 | Bearer JWT from Keycloak |
| Keycloak (IdP) | http://localhost:8081 | `admin` / `admin` |
| PostgreSQL | `localhost:55432` | `falcone` / `falcone` |
| MongoDB (rs0) | `localhost:57017` | — |
| Redpanda (Kafka) | `localhost:19092` | — |
| MinIO (S3 API) | http://localhost:59000 | `minioadmin` / `minioadmin` |
| MinIO console | http://localhost:59001 | `minioadmin` / `minioadmin` |
| Vault (dev) | http://localhost:58200 | token `root` |

### 4. Exercise it

```bash
# Run the unit / contract / e2e suites against the live stack
pnpm test

# or the public-interface black-box contract suite
bash tests/blackbox/run.sh
```

### 5. Tear it down

```bash
cd tests/env
./down.sh
# or: docker compose -f tests/env/docker-compose.yml down -v
```

> For a full production-grade deployment (functions runtime, the control-plane and
> the web console), use the Helm charts under `helm/` and `charts/` on a Kubernetes
> cluster — see the manifests in `deploy/`.

---

## Repository layout

```
apps/            control-plane (REST API surface) · web-console (React UI)
services/        gateway-config, realtime-gateway, webhook-engine, cdc-bridges,
                 scheduling-engine, provisioning-orchestrator, backup-status,
                 audit, adapters, internal-contracts, …
charts/ helm/    Kubernetes / Helm deployment
deploy/          APISIX routes, kind/OpenShift bootstrap
tests/           blackbox (contract) · e2e (Playwright) · env (Compose stack)
openspec/        spec-driven change workflow
```

---

## Third-party software and licenses

Falcone itself is **MIT-licensed** (see [LICENSE](./LICENSE)). It builds on the third-party
software below. Components marked ⚠ are **copyleft or source-available** (not OSI open source) —
see the compatibility note that follows.

### Platform & infrastructure (deployed as services / images)

| Component | Role in Falcone | License (SPDX) | Link |
| --- | --- | --- | --- |
| PostgreSQL 16 (+ pgvector) | Primary tenant datastore; RLS + schema-per-tenant isolation; pgvector for vector search | `PostgreSQL` | [postgresql.org](https://www.postgresql.org/about/licence/) · [pgvector](https://github.com/pgvector/pgvector) |
| MongoDB Server 7 | Per-tenant/workspace document data API | ⚠ `SSPL-1.0` | [mongodb.com](https://www.mongodb.com/legal/licensing/community-edition) |
| Redpanda 24.2 | Kafka-compatible event bus / CDC streaming | ⚠ `BSL-1.1` (Redpanda) + `RCL` | [licenses](https://github.com/redpanda-data/redpanda/tree/dev/licenses) |
| MinIO | S3-compatible object storage | ⚠ `AGPL-3.0` | [LICENSE](https://github.com/minio/minio/blob/master/LICENSE) |
| HashiCorp Vault 1.18 | Secrets management | ⚠ `BUSL-1.1` | [LICENSE](https://github.com/hashicorp/vault/blob/main/LICENSE) |
| Keycloak 26 | Realm-per-tenant IAM / OIDC | `Apache-2.0` | [keycloak](https://github.com/keycloak/keycloak) |
| Apache APISIX 3.9 | API gateway (public `/v1` surface) | `Apache-2.0` | [apisix](https://github.com/apache/apisix) |
| Temporal (server 1.25 + TypeScript SDK 1.18) | Durable workflow engine behind Flows | `MIT` | [temporal](https://github.com/temporalio/temporal) · [sdk-typescript](https://github.com/temporalio/sdk-typescript) |
| Knative Serving + Kourier | Serverless functions runtime | `Apache-2.0` | [serving](https://github.com/knative/serving) · [net-kourier](https://github.com/knative-extensions/net-kourier) |
| Apache OpenWhisk | Legacy / optional functions engine | `Apache-2.0` | [openwhisk](https://github.com/apache/openwhisk) |
| Kubernetes + Helm | Deployment & orchestration | `Apache-2.0` | [kubernetes](https://github.com/kubernetes/kubernetes) · [helm](https://github.com/helm/helm) |
| Node.js 22 | Service runtime | `MIT` | [nodejs](https://github.com/nodejs/node) |
| nginx | Static serving of the web-console image | `BSD-2-Clause` | [nginx.org](https://nginx.org/LICENSE) |

### Principal application frameworks & libraries (npm)

| Component | Role in Falcone | License (SPDX) | Link |
| --- | --- | --- | --- |
| React 18 | Web console UI | `MIT` | [react](https://github.com/facebook/react) |
| Vite | Console build & dev server | `MIT` | [vite](https://github.com/vitejs/vite) |
| TypeScript | Typed source (console, workflow worker) | `Apache-2.0` | [TypeScript](https://github.com/microsoft/TypeScript) |
| Tailwind CSS | Console styling | `MIT` | [tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| React Flow (`@xyflow/react`) | Visual Flows designer canvas | `MIT` | [xyflow](https://github.com/xyflow/xyflow) |
| Monaco Editor (+ `monaco-yaml`) | In-console code / YAML editing | `MIT` | [monaco-editor](https://github.com/microsoft/monaco-editor) |
| node-postgres (`pg`) | PostgreSQL client | `MIT` | [node-postgres](https://github.com/brianc/node-postgres) |
| MongoDB Node Driver (`mongodb`) | MongoDB client | `Apache-2.0` | [node-mongodb-native](https://github.com/mongodb/node-mongodb-native) |
| KafkaJS | Kafka / Redpanda client | `MIT` | [kafkajs](https://github.com/tulios/kafkajs) |
| AWS SDK for JS v3 (`@aws-sdk/client-s3`) | S3 / MinIO client | `Apache-2.0` | [aws-sdk-js-v3](https://github.com/aws/aws-sdk-js-v3) |
| jose + jwks-rsa | JWT / JWKS validation | `MIT` | [jose](https://github.com/panva/jose) · [node-jwks-rsa](https://github.com/auth0/node-jwks-rsa) |
| ws | WebSocket realtime gateway | `MIT` | [ws](https://github.com/websockets/ws) |
| Ajv | JSON Schema validation | `MIT` | [ajv](https://github.com/ajv-validator/ajv) |
| cel-js | Capability / policy expression evaluation | `MIT` | [cel-js](https://www.npmjs.com/package/cel-js) |
| Playwright | Real-stack E2E tests | `Apache-2.0` | [playwright](https://github.com/microsoft/playwright) |

> [!IMPORTANT]
> **License compatibility — review needed.** Falcone's own code is **MIT**, which is compatible
> with consuming all the permissive components above (MIT, Apache-2.0, ISC, BSD, PostgreSQL).
> The ⚠ components are **not** OSI open source and deserve review:
> - **MongoDB (`SSPL-1.0`)**, **MinIO (`AGPL-3.0`)**, **Redpanda (`BSL-1.1` + `RCL`)** and
>   **Vault (`BUSL-1.1`)** are copyleft or source-available.
> - Running them as **separate backing services Falcone talks to over the network** does not, by
>   itself, impose their license on Falcone's MIT code (no linking / derivative work). **But** their
>   "offer-as-a-service" / "competitive service" clauses are directly relevant to a multitenant BaaS
>   that **re-exposes** their functionality to tenants — a Mongo data API, a Kafka/events API, an
>   S3 storage API. In particular, **SSPL §13 and AGPL §13 target offering the software's
>   functionality as a service**, and the Redpanda/Vault BSL grants exclude competing managed
>   offerings. Review these terms before any hosted or commercial offering. All four are swappable
>   at the deployment layer if their terms don't fit your use.

**Not exhaustive.** This table lists the **principal** third-party components, not the full
transitive dependency tree (minor utilities — `undici`, `clsx`, `lucide-react`, `uuid`,
`cron-parser`, `js-yaml`, etc. — are omitted). For a complete picture, generate an SBOM / license
report — e.g. `license-checker` or `pnpm licenses list` for the npm workspaces — and, if Python or
Go components are added later, `pip-licenses` and `go-licenses` respectively. Review the output
before distribution.

---

## License

See [LICENSE](./LICENSE).
