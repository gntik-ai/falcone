# Services & Components

This page describes **every architecture component** of In Falcone — what it does, where it lives in the repository / chart, and how it participates in tenant isolation. Core components are packaged as unconditional dependencies of the umbrella Helm chart (`../falcone-charts/charts/in-falcone`); legacy `<component>.enabled=false` service disables and zero-replica core overrides are rejected by chart validation.

The canonical release/source map is [`service-catalog.json`](../../service-catalog.json). It lists the six release-published Falcone images (`in-falcone-control-plane`, `in-falcone-control-plane-executor`, `in-falcone-web-console`, `in-falcone-fn-runtime`, `in-falcone-workflow-worker`, `in-falcone-mcp-runtime`) with their chart alias/value key, co-located Dockerfile, direct dependencies and inter-service calls. Packages such as `realtime-gateway`, `mongo-cdc-bridge`, `pg-cdc-bridge` and `workspace-docs-service` are documented there as non-release evidence when they are not published images.

```
EDGE          CONTROL & DATA PLANE        DATA BACKENDS           PLATFORM
─────         ────────────────────        ─────────────           ────────
APISIX  ─────▶ Control Plane              PostgreSQL              Keycloak (identity)
gateway        Executor                   FerretDB + DocumentDB   OpenBao + ESO (secrets)
               Adapters                   Kafka / Redpanda        Prometheus (observability)
Web Console    Realtime Engine            SeaweedFS (storage)     Bootstrap & Provisioning
               Functions runtime
```

---

## API Gateway (APISIX)

**Chart alias:** `apisix` · **Config:** `deploy/gateway-config/`, `scripts/lib/gateway-policy.mjs` · **Route catalog:** `deploy/gateway-config/public-route-catalog.json`

APISIX is the single ingress for the public API. It is responsible for:

- **Credential classification & routing.** It splits traffic by credential: an `apikey: flc_…` header (anon/service keys) is matched by a route-variable rule (`vars` on `^flc_`) and sent to the executor; a Bearer JWT path is validated and routed with verified identity headers injected. The split means the data plane and admin plane are reachable through one host.
- **Scope enforcement.** A custom plugin maps each route to its `privilege_domain` (`structural_admin` vs `data_access`) and rejects callers whose verified scope doesn't match (`deploy/gateway-config/tests/plugins/scope-enforcement-*`).
- **Per-key rate limiting.** APISIX `limit-count` uses `key_type: var_combination` with `$http_apikey`, so each API key gets its own bucket (using `var` would key globally). `policy: local` is node-local (≈ N× the limit with N replicas); `policy: redis` is globally exact.
- **Identity injection.** After validating a token, the gateway injects `x-tenant-id` / `x-workspace-id` / `x-auth-subject` / `x-pg-role` and strips any client-supplied context headers, so downstream services receive only trusted context.

In Kubernetes the routes are reconciled by the **bootstrap job** from `bootstrap.reconcile.apisix.routes`; the kind dev cluster uses a hand-maintained standalone config (`deploy/kind/apisix/apisix.yaml`).

---

## Control Plane

**Chart alias:** `controlPlane` · **Code:** `apps/control-plane/` · **Image:** `in-falcone-control-plane`

The control plane owns **platform metadata and lifecycle**: tenants, workspaces, members, schemas, function deployment, API keys, service configuration and quotas — the entire `structural_admin` surface. It mutates the platform's own datastore and reconciles downstream resources (gateway routes, identity realm entries, provisioning of per-workspace databases).

The runnable HTTP service (`apps/control-plane/server.mjs`) validates identity, matches `/v1/*` requests against the route map, dispatches to product action modules, and injects the dependencies each action needs. Some helper/action modules are loaded from `apps/control-plane-executor`, but the release control-plane image source and Dockerfile are co-located under `apps/control-plane`.

---

## Executor (data-plane runtime)

**Chart alias:** `controlPlaneExecutor` · **Code:** `apps/control-plane-executor/` · **Image:** `in-falcone-control-plane-executor`

The executor is the **data plane**. Its HTTP entrypoint is `apps/control-plane-executor/src/runtime/server.mjs`; executor modules are deliberately dependency-light and take adapter-built plans that execute against real drivers. One executor module per backend family:

| Module | Backend | Responsibility |
| --- | --- | --- |
| `postgres-data-executor.mjs` | PostgreSQL | row CRUD + bulk + query, under RLS |
| `postgres-ddl-executor.mjs` | PostgreSQL | schema/table/column/index DDL |
| `mongo-data-executor.mjs` | FerretDB / DocumentDB | document CRUD + query (MongoDB wire protocol) |
| `events-executor.mjs` | Kafka | publish/subscribe |
| `functions-executor.mjs` | Functions runtime | invoke |
| `realtime-executor.mjs` | FerretDB / DocumentDB | Postgres logical-replication subscriptions |
| `postgres-realtime-executor.mjs` | PostgreSQL | trigger + `LISTEN/NOTIFY` CDC |

Supporting modules: `connection-registry.mjs` (resolve a workspace's connection URI), `api-keys.mjs` (verify `flc_…` keys → tenant/workspace/DB role/scopes), `jwt-verify.mjs` (verify Bearer tokens). The executor's `resolveIdentity()` enforces the credential precedence described in the [overview](/architecture/overview#identity-resolution-precedence).

Every executor call carries an `identity` and **stamps/filters by `tenantId`** — for PostgreSQL via the RLS-bound role, for the FerretDB/DocumentDB document store via an injected predicate (the MongoDB wire protocol has no RLS / `SET ROLE`, so the adapter predicate is the guard).

---

## Data Adapters

**Code:** `packages/adapters/src/{postgresql-data-api,mongodb-data-api}.mjs`

Adapters are pure **plan builders**: they translate a logical data request (collection, filters, ordering, pagination, mutation) into a concrete plan the executor runs. Examples:

- `buildPostgresDataApiPlan()` — produces parameterized SQL, PostgREST-style filters (`eq/neq/gt/gte/lt/lte/in/like/ilike/json_path_eq`), `select` projection, `order`, and **keyset (cursor) pagination** (`serializePostgresDataApiCursor`, `page[after]`).
- The MongoDB adapter — produces find/aggregate specs and **cursor pagination** (`encodeMongoDataCursor`), always with the tenant predicate.

Keeping plan-building separate from execution makes the data layer testable without a database and keeps the tenant predicate in one place.

---

## Web Console

**Chart alias:** `webConsole` · **Code:** `apps/web-console/` · **Image:** `in-falcone-web-console`

A browser app for operators and developers. It authenticates against Keycloak (OIDC) and operates within a selected **tenant context**. The console surfaces the whole platform: tenants, workspace context, IAM (members, roles, service accounts & credentials), PostgreSQL and MongoDB browsers, object storage, the event bus, serverless functions, plans, quotas, observability and operations. (See the [tour](/guide/what-is-falcone#a-guided-tour-of-a-real-deployment).)

The console talks to the same public API as any other client, so anything it does is reproducible over HTTP. The release Dockerfile at `apps/web-console/Dockerfile` serves the prebuilt Vite bundle with `apps/web-console/static-server.mjs`, a Node static server that runs as a numeric non-root user without filesystem writes. Anon-key embeds let you render read-only data in an external frontend.

---

## Realtime Engine

**Code:** `apps/control-plane-executor/src/runtime/realtime-executor.mjs`, `postgres-realtime-executor.mjs` · **Package:** `packages/realtime-gateway` (non-release evidence; no published image)

Realtime delivers live data changes over **Server-Sent Events** (no WebSocket dependency). Two sources:

- **Document-store CDC (Postgres logical replication).** FerretDB v2 over DocumentDB has no MongoDB change streams, so document realtime is sourced from a Postgres **`pgoutput`** logical-replication slot on the DocumentDB engine's `documentdb_data` tables. `REPLICA IDENTITY FULL` carries delete pre-images, and the verified tenant is enforced by **consumer-side `tenantId` filtering** (the structural equivalent of the old change-stream `$match`). A WAL `UPDATE` surfaces as `operationType: 'replace'` (logical replication carries the full new image). `wal_level=logical` is the enabling GUC. See the [FerretDB Document-Store Runbook](/architecture/ferretdb#change-stream-remediation).
- **PostgreSQL trigger CDC.** A trigger emits `NOTIFY` on a per-tenant channel (`flc_rt_<md5(schema.table:tenant_id)>`); the engine `LISTEN`s on the caller's channel only. Deletes use `OLD.tenant_id`; payloads above ~8000 bytes are guarded.

Because tenant matching happens **inside** the pipeline/channel, a subscriber can only ever receive its own tenant's changes. A subscribe without tenant identity returns `401`. EventSource can't set headers, so SSE routes accept the anon key as `?apikey=`.

---

## PostgreSQL (relational backend)

**Chart alias:** `postgresql` · **Baseline:** `docs/reference/postgresql/tenant-isolation-baseline.sql`

The relational data engine. Tenant isolation rests on **Row-Level Security**:

- Tenant-scoped tables carry a `tenant_id` and a fail-closed RLS policy.
- The application connects as a **non-`BYPASSRLS` role** (`falcone_app`, with `anon`/`service` variants). Because RLS does not apply to superusers/`BYPASSRLS` roles, using a constrained role is what makes the policy actually enforce.
- The executor sets the tenant context (`SET LOCAL`) and role per request, so policies filter every statement — including ones a bug forgot to scope.

RLS is only meaningfully testable against a real Postgres. For the local backend stack, run
`docker compose up -d` from `tests/env` as described in [Contributing](/contributing/).

---

## Document Store (FerretDB + DocumentDB)

**Chart aliases:** `ferretdb` + `documentdb` (replaced the former `mongodb` server component, now removed — [ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb))

The document data engine, also the source for document realtime. It is a two-layer stack that preserves the **MongoDB wire protocol** while replacing the storage engine: a stateless **FerretDB v2 gateway** speaks the MongoDB wire protocol and translates it to SQL against a **DocumentDB-on-PostgreSQL 17** engine. Falcone's existing MongoDB driver and the data-API executor connect unchanged via `MONGO_URI`. Isolation is enforced in the **adapter/executor** (injected `tenantId` filter on reads, stamped on writes) rather than in the engine. There is **no replica set and no keyfile** — durable state lives in the engine's PostgreSQL volume. Document realtime is not change streams: it is sourced from a Postgres **`pgoutput`** logical-replication slot (`wal_level=logical`, `REPLICA IDENTITY FULL`, consumer-side `tenantId` filter). For topology, the two-layer design, the tenancy model and day-2 operations see the [FerretDB Document-Store Runbook](/architecture/ferretdb).

---

## Object Storage (SeaweedFS)

**Chart alias:** `seaweedfs` (replaced the former MinIO `storage` component, now removed — [ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs))

S3-compatible object storage (SeaweedFS, Apache-2.0) exposed as `…/objects/{bucket}/{key}` (`data_access`). Object paths are tenant-scoped so one tenant's keys never resolve into another's namespace. For topology, the filer-on-PostgreSQL metadata store, the per-tenant identity model and day-2 operations see the [SeaweedFS Storage Runbook](/architecture/seaweedfs).

---

## Event Bus (Kafka / Redpanda)

**Chart alias:** `kafka`

A tenant-scoped publish/subscribe stream (`/v1/events/publish`, `/v1/events/subscribe`). In production this is Kafka; the docker-compose dev stack uses **Redpanda** (Kafka-compatible). Topics and consumption are scoped per tenant.

---

## Serverless Functions

**Release image:** `in-falcone-fn-runtime` via `controlPlane.env.FN_RUNTIME_IMAGE` · **Code:** `apps/fn-runtime/`

Per-tenant serverless functions: deploy (`POST /v1/functions`, `structural_admin`/`function_deployment`) and invoke (`POST /v1/functions/{id}/invoke`, `data_access`). The platform runs functions on a **Knative-based runtime** (migrated off OpenWhisk): the control-plane executor provisions one Knative Service per function from `FN_RUNTIME_IMAGE` and manages function lifecycle via Kubernetes RBAC (`templates/control-plane-rbac.yaml`). The public API keeps the OpenWhisk-compatible action/package/trigger/rule model.

---

## Flows / Workflow Engine (Temporal)

**Chart aliases:** `temporal`, `workflowWorker` (core baseline) · **Code:** `apps/workflow-worker/`, `apps/control-plane-executor/src/runtime/flow-*.mjs` · **DSL:** `packages/internal-contracts/src/flow-definition.json`

A durable workflow engine. Tenants author **flows** as a YAML DSL; the control plane stores immutable versions and starts each execution as a **Temporal** workflow, run by a single generic interpreter (`DslInterpreterWorkflow`) that maps DSL nodes (`sequence`/`parallel`/`task`/`branch`/`wait`/`approval`/`sub-flow`) to Temporal primitives. Temporal is **internal-only** (no public route; operator-only Web UI) and uses a **shared namespace** (`falcone-flows`) with server-stamped `tenantId`/`workspaceId`/`flowId`/`flowVersion`/`triggerType` search attributes for isolation, plus PostgreSQL SQL visibility (no Elasticsearch). Every workflow id is `{tenantId}:{workspaceId}:{flowId}:{runUuid}`, generated server-side and prefix-checked on every command. See [Flows Architecture](/architecture/flows), the [Flows Runbook](/architecture/flows-runbook), the tenant [Flows guide](/guide/flows), and [ADR-11](/architecture/adrs#adr-11-temporal-for-the-durable-workflow-flows-engine).

---

## MCP Server Hosting (Preview)

**Chart alias:** `mcp` (core baseline) · **Code:** `apps/control-plane-executor/src/runtime/mcp-engine.mjs`, `apps/control-plane-executor/src/mcp-*.mjs` · **Runtime image:** `apps/mcp-runtime/` (`in-falcone-mcp-runtime`) · **API:** `/v1/mcp/workspaces/{ws}/servers/…`

Hosts tenant **Model Context Protocol** servers so AI agents can call the backend as **tools**. The control-plane runtime serves the management API (create → curate → publish → call → audit) as part of the core install; `mcp-engine` composes the MCP modules — the **instant generator** (tools from a Postgres schema / function / bucket / topic), the **official catalog** (curated read-first platform tools), mandatory **curation**, the **registry** (digest-pinned versions + rug-pull review), per-tenant **quotas/rate-limits**, and **observability/audit** (the `mcp` audit subsystem). Remote transport is **Streamable HTTP**; access is per-tenant **OAuth 2.1** with per-tool scopes via Keycloak (the MCP-aware Authorization Server). Hosted MCP-server pods are **internal-only** (NetworkPolicy), reachable only via the gateway, and scale to zero on Knative.

Status: **Instant MCP** and the **official server** are live (Preview); registry, version, audit, and rate-limit state is durable in PostgreSQL; **custom (bring-your-own-image) hosting** and **workflows-as-MCP-tools** are **Experimental** (built but not on the live create path). See [MCP Architecture](/architecture/mcp), the [MCP Runbook](/architecture/mcp-runbook), the tenant [MCP guide](/guide/mcp), and [ADR-12](/architecture/adrs#adr-12-mcp-server-hosting-runtime-gateway-oauth-and-isolation).

---

## Identity (Keycloak)

**Chart alias:** `keycloak`

Keycloak is the OIDC identity provider. It backs console login, issues per-tenant JWTs, and is the source of the verified claims the gateway turns into identity headers. The bootstrap job reconciles the realm on install. The docker-compose stack auto-imports a realm for development.

---

## Secret Management (OpenBao + External Secrets)

**Chart aliases:** `openbao`, `eso`

Secrets are sourced from **OpenBao** (the open-source Vault fork) via the **External Secrets Operator**, so the chart references secret *names* rather than embedding secret values. The dev compose stack runs OpenBao in `-dev` mode. (Sensitive material like the FerretDB/DocumentDB Postgres credentials behind `MONGO_URI` is created as a Kubernetes Secret and mounted via `secretKeyRef`, never inlined.)

---

## Observability (Prometheus)

**Chart alias:** `observability`

Prometheus-based metrics with per-tenant usage and quota signals surfaced in the console's observability and operations views. The platform also maintains an audit pipeline and business/usage metrics (the many `validate:observability-*` repo checks gate their schemas).

---

## Bootstrap & Provisioning

**Templates:** `../falcone-charts/charts/in-falcone/templates/bootstrap-payload-configmap.yaml`, `NOTES.txt` · **Service:** `packages/provisioning-orchestrator/`

On install/upgrade a **bootstrap hook job** reconciles the gateway routes, the identity realm and the initial platform configuration. It is **idempotent**, guarded by a lock ConfigMap and recorded by a marker ConfigMap, so repeated upgrades are safe. The provisioning orchestrator handles per-workspace database/schema creation and migrations (e.g. the admin/data privilege separation migration).
