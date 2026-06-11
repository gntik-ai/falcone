# Services & Components

This page describes **every architecture component** of In Falcone — what it does, where it lives in the repository / chart, and how it participates in tenant isolation. Components are packaged as dependencies of the umbrella Helm chart (`charts/in-falcone`), each wrapped by a shared `component-wrapper` subchart and toggled with `<component>.enabled`.

```
EDGE          CONTROL & DATA PLANE        DATA BACKENDS           PLATFORM
─────         ────────────────────        ─────────────           ────────
APISIX  ─────▶ Control Plane              PostgreSQL              Keycloak (identity)
gateway        Executor                   MongoDB                 Vault + ESO (secrets)
               Adapters                   Kafka / Redpanda        Prometheus (observability)
Web Console    Realtime Engine            MinIO (storage)         Bootstrap & Provisioning
               Functions runtime
```

---

## API Gateway (APISIX)

**Chart alias:** `apisix` · **Config:** `services/gateway-config/`, `scripts/lib/gateway-policy.mjs` · **Route catalog:** `services/gateway-config/public-route-catalog.json`

APISIX is the single ingress for the public API. It is responsible for:

- **Credential classification & routing.** It splits traffic by credential: an `apikey: flc_…` header (anon/service keys) is matched by a route-variable rule (`vars` on `^flc_`) and sent to the executor; a Bearer JWT path is validated and routed with verified identity headers injected. The split means the data plane and admin plane are reachable through one host.
- **Scope enforcement.** A custom plugin maps each route to its `privilege_domain` (`structural_admin` vs `data_access`) and rejects callers whose verified scope doesn't match (`services/gateway-config/tests/plugins/scope-enforcement-*`).
- **Per-key rate limiting.** APISIX `limit-count` uses `key_type: var_combination` with `$http_apikey`, so each API key gets its own bucket (using `var` would key globally). `policy: local` is node-local (≈ N× the limit with N replicas); `policy: redis` is globally exact.
- **Identity injection.** After validating a token, the gateway injects `x-tenant-id` / `x-workspace-id` / `x-auth-subject` / `x-pg-role` and strips any client-supplied context headers, so downstream services receive only trusted context.

In Kubernetes the routes are reconciled by the **bootstrap job** from `bootstrap.reconcile.apisix.routes`; the kind dev cluster uses a hand-maintained standalone config (`deploy/kind/apisix/apisix.yaml`).

---

## Control Plane

**Chart alias:** `controlPlane` · **Code:** `apps/control-plane/`

The control plane owns **platform metadata and lifecycle**: tenants, workspaces, members, schemas, function deployment, API keys, service configuration and quotas — the entire `structural_admin` surface. It mutates the platform's own datastore and reconciles downstream resources (gateway routes, identity realm entries, provisioning of per-workspace databases).

The runnable HTTP service (`apps/control-plane/src/runtime/server.mjs`) also fronts the data plane: it matches requests against a small route table, resolves identity, and dispatches to the executors. Paths it does not serve itself are reverse-proxied to the legacy control-plane upstream — and that proxy is **SSRF-safe by construction**: protocol/host/port are pinned to the operator-configured upstream and only the path+query come from the request.

---

## Executor (data-plane runtime)

**Chart alias:** `controlPlaneExecutor` · **Code:** `apps/control-plane/src/runtime/*-executor.mjs`

The executor is the **data plane**. It is deliberately dependency-light: it takes an adapter-built plan and executes it against a real driver. One executor module per backend family:

| Module | Backend | Responsibility |
| --- | --- | --- |
| `postgres-data-executor.mjs` | PostgreSQL | row CRUD + bulk + query, under RLS |
| `postgres-ddl-executor.mjs` | PostgreSQL | schema/table/column/index DDL |
| `mongo-data-executor.mjs` | MongoDB | document CRUD + query |
| `events-executor.mjs` | Kafka | publish/subscribe |
| `functions-executor.mjs` | Functions runtime | invoke |
| `realtime-executor.mjs` | MongoDB | change-stream subscriptions |
| `postgres-realtime-executor.mjs` | PostgreSQL | trigger + `LISTEN/NOTIFY` CDC |

Supporting modules: `connection-registry.mjs` (resolve a workspace's connection URI), `api-keys.mjs` (verify `flc_…` keys → tenant/workspace/DB role/scopes), `jwt-verify.mjs` (verify Bearer tokens). The executor's `resolveIdentity()` enforces the credential precedence described in the [overview](/architecture/overview#identity-resolution-precedence).

Every executor call carries an `identity` and **stamps/filters by `tenantId`** — for PostgreSQL via the RLS-bound role, for MongoDB via an injected predicate.

---

## Data Adapters

**Code:** `services/adapters/src/{postgresql-data-api,mongodb-data-api}.mjs`

Adapters are pure **plan builders**: they translate a logical data request (collection, filters, ordering, pagination, mutation) into a concrete plan the executor runs. Examples:

- `buildPostgresDataApiPlan()` — produces parameterized SQL, PostgREST-style filters (`eq/neq/gt/gte/lt/lte/in/like/ilike/json_path_eq`), `select` projection, `order`, and **keyset (cursor) pagination** (`serializePostgresDataApiCursor`, `page[after]`).
- The MongoDB adapter — produces find/aggregate specs and **cursor pagination** (`encodeMongoDataCursor`), always with the tenant predicate.

Keeping plan-building separate from execution makes the data layer testable without a database and keeps the tenant predicate in one place.

---

## Web Console

**Chart alias:** `webConsole` · **Code:** `apps/web-console/` (or `services/web-console`)

A browser app for operators and developers. It authenticates against Keycloak (OIDC) and operates within a selected **tenant context**. The console surfaces the whole platform: tenants, workspace context, IAM (members, roles, service accounts & credentials), PostgreSQL and MongoDB browsers, object storage, the event bus, serverless functions, plans, quotas, observability and operations. (See the [tour](/guide/what-is-falcone#a-guided-tour-of-a-real-deployment).)

The console talks to the same public API as any other client, so anything it does is reproducible over HTTP. Anon-key embeds let you render read-only data in an external frontend.

---

## Realtime Engine

**Code:** `apps/control-plane/src/runtime/realtime-executor.mjs`, `postgres-realtime-executor.mjs` · **Service:** `services/realtime-gateway`

Realtime delivers live data changes over **Server-Sent Events** (no WebSocket dependency). Two sources:

- **MongoDB change streams.** `collection.watch()` with a pipeline that `$match`es the verified tenant. insert/update/replace are scoped on `fullDocument.tenantId`; **deletes** are scoped on `fullDocumentBeforeChange.tenantId`, which requires collection **pre-images** (`changeStreamPreAndPostImages`, MongoDB 6.0+, enabled best-effort on subscribe). Change streams require a **replica set**.
- **PostgreSQL trigger CDC.** A trigger emits `NOTIFY` on a per-tenant channel (`flc_rt_<md5(schema.table:tenant_id)>`); the engine `LISTEN`s on the caller's channel only. Deletes use `OLD.tenant_id`; payloads above ~8000 bytes are guarded.

Because tenant matching happens **inside** the pipeline/channel, a subscriber can only ever receive its own tenant's changes. A subscribe without tenant identity returns `401`. EventSource can't set headers, so SSE routes accept the anon key as `?apikey=`.

---

## PostgreSQL (relational backend)

**Chart alias:** `postgresql` · **Baseline:** `docs/reference/postgresql/tenant-isolation-baseline.sql`

The relational data engine. Tenant isolation rests on **Row-Level Security**:

- Tenant-scoped tables carry a `tenant_id` and a fail-closed RLS policy.
- The application connects as a **non-`BYPASSRLS` role** (`falcone_app`, with `anon`/`service` variants). Because RLS does not apply to superusers/`BYPASSRLS` roles, using a constrained role is what makes the policy actually enforce.
- The executor sets the tenant context (`SET LOCAL`) and role per request, so policies filter every statement — including ones a bug forgot to scope.

RLS is only meaningfully testable against a real Postgres (see the [docker-compose stack](/guide/installation#docker-compose-local)).

---

## MongoDB (document backend)

**Chart alias:** `mongodb`

The document data engine, also the source for Mongo realtime. Isolation is enforced in the **adapter/executor** (injected `tenantId` filter on reads, stamped on writes) rather than in the engine, and reinforced in the change-stream pipeline. It must run as a **replica set** (`rs0`) so change streams (hence realtime) work — the compose stack and the platform run it single-node-RS for development.

---

## Object Storage (MinIO)

**Chart alias:** `storage`

S3-compatible object storage exposed as `…/objects/{bucket}/{key}` (`data_access`). Object paths are tenant-scoped so one tenant's keys never resolve into another's namespace.

---

## Event Bus (Kafka / Redpanda)

**Chart alias:** `kafka`

A tenant-scoped publish/subscribe stream (`/v1/events/publish`, `/v1/events/subscribe`). In production this is Kafka; the docker-compose dev stack uses **Redpanda** (Kafka-compatible). Topics and consumption are scoped per tenant.

---

## Serverless Functions

**Chart alias:** `openwhisk` (functions runtime)

Per-tenant serverless functions: deploy (`POST /v1/functions`, `structural_admin`/`function_deployment`) and invoke (`POST /v1/functions/{id}/invoke`, `data_access`). The platform runs functions on a **Knative-based runtime** (migrated off OpenWhisk; the chart alias is retained). The control plane manages function lifecycle via Kubernetes RBAC (`templates/control-plane-rbac.yaml`).

---

## Identity (Keycloak)

**Chart alias:** `keycloak`

Keycloak is the OIDC identity provider. It backs console login, issues per-tenant JWTs, and is the source of the verified claims the gateway turns into identity headers. The bootstrap job reconciles the realm on install. The docker-compose stack auto-imports a realm for development.

---

## Secret Management (Vault + External Secrets)

**Chart aliases:** `vault`, `eso`

Secrets are sourced from **HashiCorp Vault** via the **External Secrets Operator**, so the chart references secret *names* rather than embedding secret values. The dev compose stack runs Vault in `-dev` mode. (Sensitive material like the MongoDB replica-set keyfile is created as a Kubernetes Secret and mounted via `secretKeyRef`, never inlined.)

---

## Observability (Prometheus)

**Chart alias:** `observability`

Prometheus-based metrics with per-tenant usage and quota signals surfaced in the console's observability and operations views. The platform also maintains an audit pipeline and business/usage metrics (the many `validate:observability-*` repo checks gate their schemas).

---

## Bootstrap & Provisioning

**Templates:** `charts/in-falcone/templates/bootstrap-payload-configmap.yaml`, `NOTES.txt` · **Service:** `services/provisioning-orchestrator/`

On install/upgrade a **bootstrap hook job** reconciles the gateway routes, the identity realm and the initial platform configuration. It is **idempotent**, guarded by a lock ConfigMap and recorded by a marker ConfigMap, so repeated upgrades are safe. The provisioning orchestrator handles per-workspace database/schema creation and migrations (e.g. the admin/data privilege separation migration).
