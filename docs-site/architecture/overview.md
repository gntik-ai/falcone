# Architecture Overview

In Falcone is a **multi-tenant BaaS** assembled from a small set of cooperating services in front of standard data backends. The design has three throughlines:

1. **One gateway, two privilege domains.** Everything enters through APISIX, which classifies a request by its credential and routes it to either the **control plane** (`structural_admin`) or the **executor** (`data_access`).
2. **Identity derives the tenant — never the client.** The tenant/workspace come from a verified credential (API key → JWT → gateway-injected headers, in that order). Client-supplied `x-tenant-id` is never trusted. Invalid credentials fail closed.
3. **Isolation is enforced at the data layer**, not just at the edge. PostgreSQL Row-Level Security with a non-`BYPASSRLS` role, FerretDB/DocumentDB adapter-injected predicates, and tenant-scoped realtime matching mean a routing mistake cannot leak data.

## Request lifecycle

```
                 ┌──────────────────────────────────────────────────────┐
   Browser /     │                  APISIX  (API gateway)                │
   App / CLI ───▶│  • classify credential:  apikey: flc_…  | Bearer JWT  │
                 │  • enforce scope (structural_admin | data_access)     │
                 │  • rate-limit per key  • inject verified identity hdrs │
                 └───────────────┬───────────────────────┬──────────────┘
                                 │ structural_admin       │ data_access
                                 ▼                        ▼
                    ┌────────────────────┐   ┌──────────────────────────────┐
                    │   Control Plane    │   │          Executor            │
                    │  tenants/workspaces│   │  resolveIdentity()           │
                    │  schemas/functions │   │  build*Plan() → run on driver│
                    │  api-keys/quotas   │   └───┬─────┬─────┬─────┬─────┬───┘
                    │  /v1/flows /v1/mcp │       │     │     │     │     │
                    └─────────┬──────────┘       │     │     │     │     │
                              │              Postgres FerretDB Kafka SeaweedFS Funcs
                              ▼                  │     │     │     │     │
                    ┌────────────────────┐      ▼     ▼     ▼     ▼     ▼
                    │  Platform metadata │   (per-workspace data backends, tenant-scoped)
                    │  (tenants, plans…) │
                    └────────────────────┘

         Identity: Keycloak (OIDC)  ·  Secrets: OpenBao + External Secrets  ·  Metrics: Prometheus
```

- A **data-plane** call (e.g. `GET /v1/collections/todos/documents` with `apikey: flc_anon_…`) is routed by the gateway to the executor. The executor verifies the key, resolves the tenant/workspace and DB role from it, builds an adapter query plan, and runs it against the workspace's real database — under RLS.
- A **structural-admin** call (e.g. `POST /v1/tenants` with a Bearer admin token) is routed to the control plane, which mutates platform metadata and reconciles downstream resources (gateway routes, identity realm, provisioning).

## The two privilege domains

The public route catalog (`deploy/gateway-config/public-route-catalog.json`) tags every route with a `privilege_domain`. The gateway's scope-enforcement plugin checks the caller's domain before forwarding:

| Domain | Examples | Typical caller |
| --- | --- | --- |
| `structural_admin` | `POST /v1/tenants`, `POST /v1/workspaces`, `POST /v1/schemas`, `POST /v1/functions`, `POST /v1/api-keys`, `PUT /v1/quotas`, `POST /v1/services/configure` | Operators, tenant admins (Bearer JWT) |
| `data_access` | `…/collections/{name}/documents`, `…/collections/{name}/query`, `…/objects/{bucket}/{key}`, `…/functions/{id}/invoke`, `…/events/publish`, `…/events/subscribe`, `…/analytics/query` | Applications (API keys / JWT) |

## Identity resolution (precedence)

The executor's `resolveIdentity()` (`apps/control-plane-executor/src/runtime/server.mjs`) applies a strict order. Each authoritative credential derives the tenant from itself:

```
1. API key (apikey: flc_… | Authorization: ApiKey/Bearer flc_… | x-api-key)
      → tenant, workspace, and DB role come from the verified key
      → invalid key  ⇒  401  (never falls back to headers)

2. Bearer JWT (when a verifier is configured)
      → identity from verified token claims
      → invalid token ⇒ 401

3. Gateway-injected headers (x-tenant-id / x-workspace-id / x-auth-subject / x-pg-role)
      → only trusted when no credential was presented; the gateway validated the
        token upstream and stripped any client-supplied context headers
```

This precedence is the reason a client cannot spoof a tenant: the only way to set `x-tenant-id` is through the gateway, after it has validated a token — and any presented `flc_…` key or Bearer JWT overrides headers entirely.

## Data isolation strategy

In Falcone uses a **shared-database, tenant-scoped** model with defense in depth:

- **PostgreSQL** — RLS policies on tenant-scoped tables, plus a dedicated **non-`BYPASSRLS` application role** (`falcone_app`, with `anon`/`service` variants). The executor runs queries via `SET LOCAL ROLE` so even a buggy query is constrained by RLS. (A superuser would bypass RLS — which is exactly why the app role is not a superuser.)
- **FerretDB + DocumentDB** (document store) — the data adapter injects a `tenantId` predicate into every read and stamps it on every write (the authoritative isolation boundary; per-database role scoping is NOT enforced at the engine — [ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)); the realtime pipeline (Postgres logical replication) filters consumer-side on the verified tenant.
- **Every layer** — caches, queues, object keys, events and logs are keyed by tenant so isolation holds beyond the database.

See [Security & Auth](/architecture/security) for the full model.

## AI-native layer (Flows & MCP) — *Preview*

Two core capabilities make a tenant's backend consumable by AI agents; both are served by the
control plane in a fresh install:

```
   Control Plane
   ├─ /v1/flows/workspaces/{ws}/…  ──▶  Temporal  ◀──poll──  workflow-worker
   │  (durable workflow definitions,                          (DslInterpreterWorkflow +
   │   versions, executions)                                   first-party activity catalog)
   └─ /v1/mcp/workspaces/{ws}/servers/…  ──▶  mcp-engine  ──▶  Knative ksvc (per-tenant MCP server)
      (create · curate · publish · call · audit)              served over Streamable HTTP, OAuth 2.1
```

- **Flows** — a durable [workflow engine](/guide/flows) on Temporal (chart components `temporal` +
  `workflowWorker`, wired by the chart through `TEMPORAL_ADDRESS`). Tenants author a YAML
  [DSL](/architecture/workflow-dsl-reference); the control plane stores immutable versions and runs
  each execution as a Temporal workflow. Isolation is by server-generated workflow ids
  (`{tenantId}:{workspaceId}:{flowId}:{runUuid}`) prefix-checked on every command.
- **MCP server hosting** — the control-plane runtime serves the [MCP](/guide/mcp) management API
  through `mcp-engine` as part of the core install. Instant MCP and the official server are live (Preview);
  custom (BYO-image) hosting and workflows-as-tools are Experimental; per-tenant OAuth 2.1 + per-tool
  scopes via Keycloak; MCP-server pods are internal-only.

## Where to go next

- [Services & Components](/architecture/services) — a subsection per component (gateway, control plane, executor, adapters, console, realtime, data backends, **Flows**, **MCP hosting**, identity, secrets, observability).
- [Flows](/architecture/flows) · [Workflow DSL Reference](/architecture/workflow-dsl-reference) · [MCP Server Hosting](/architecture/mcp) — the AI-native capabilities.
- [Domain Model](/architecture/domain-model) — tenants, workspaces, members, plans, quotas.
- [Deployment Topology](/architecture/deployment) — how it all maps to a cluster.
