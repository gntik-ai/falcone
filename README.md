<div align="center">
  <img src="./logo.svg" alt="Falcone" width="420" />

  <h1>Falcone</h1>

  <strong>A multitenant Backend-as-a-Service (BaaS) platform.</strong>

  <p>Databases, storage, auth, events, realtime and serverless functions — isolated per tenant, governed by plans and quotas, behind one API.</p>

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

## License

See [LICENSE](./LICENSE).
