# Security & Auth

Security in a multi-tenant BaaS reduces to one question: **can tenant A ever read or write tenant B's data?** In Falcone answers "no" with defense in depth — at the edge, in identity resolution, and in the data layer — so that a single mistake at one layer does not become a cross-tenant leak.

## Authentication: credentials

| Credential | Form | Used for |
| --- | --- | --- |
| **Anon API key** | `apikey: flc_anon_…` | Read-mostly, shippable to a browser; bound to a low-privilege RLS DB role |
| **Service API key** | `apikey: flc_service_…` | Server-side / CI; elevated within the tenant; never exposed to clients |
| **Bearer JWT** | `Authorization: Bearer <jwt>` | Operator/user calls; issued by Keycloak (OIDC) |

Keys are verified by `apps/control-plane-executor/src/runtime/api-keys.mjs`; JWTs by `jwt-verify.mjs`. Keys are matched at the gateway by the `apikey` header (route `vars` on `^flc_`).

## Authorization: identity resolution & precedence

The executor's `resolveIdentity()` applies a strict order, and **each authoritative credential derives the tenant from itself** — never from a spoofable header:

1. **API key** → tenant, workspace and DB role from the verified key. Invalid key ⇒ `401`.
2. **Bearer JWT** (when a verifier is configured) → identity from verified claims. Invalid token ⇒ `401`.
3. **Gateway-injected headers** (`x-tenant-id` / `x-workspace-id` / `x-auth-subject` / `x-pg-role`) → trusted **only** when no credential was presented; the gateway validated the token upstream and stripped client-supplied context headers.

> [!IMPORTANT]
> A presented-but-invalid credential **fails closed** — it never falls back to spoofable headers. This is the fix that closed a real spoofing bug where a client-supplied `x-tenant-id` could override the key; the API key (or verified JWT) is now authoritative.

## Authorization: privilege domains & scope

The gateway tags every public route with a `privilege_domain` and enforces it before forwarding:

- **`structural_admin`** — lifecycle/management (tenants, workspaces, schemas, functions, api-keys, quotas, service config).
- **`data_access`** — the data plane (documents, queries, objects, function invocation, events, analytics).

A `data_access` credential cannot reach `structural_admin` routes. Function routes additionally carry a `function_deployment` sub-domain. The scope-enforcement plugin lives in `deploy/gateway-config/` with Lua specs under `tests/plugins/`.

## Tenant isolation in the data layer

Edge checks are necessary but not sufficient — isolation is also enforced where the data lives:

### PostgreSQL — Row-Level Security

- Tenant-scoped tables carry `tenant_id` and a **fail-closed RLS policy** (baseline in `docs/reference/postgresql/tenant-isolation-baseline.sql`).
- The app connects as a **non-`BYPASSRLS` role** — `falcone_app`, with `anon` / `service` variants. RLS does **not** apply to superusers or `BYPASSRLS` roles, so connecting as a constrained role is precisely what makes the policy enforce.
- The executor sets the tenant context and role per request (`SET LOCAL`), so every statement is filtered — even one a bug forgot to scope.

### FerretDB / DocumentDB — adapter-injected predicate

The data adapter injects a `tenantId` filter into every read and stamps it on every write; the FerretDB/DocumentDB document store has no RLS / `SET ROLE`, so the adapter predicate **is** the isolation boundary (a forged `tenantId` is rejected with `403`). Document realtime carries the same verified tenant via a consumer-side `tenantId` filter on the Postgres logical-replication stream (see below). There is no path to issue an unscoped query through the adapter.

### Realtime — tenant-scoped at the source

Subscriptions match the verified tenant **inside** the source — for the document store, a consumer-side `tenantId` filter on the Postgres **`pgoutput`** logical-replication stream (the structural equivalent of the old change-stream `$match`); for PostgreSQL, the `LISTEN` channel. A subscriber only ever receives its own tenant's events. Deletes are tenant-scoped via `REPLICA IDENTITY FULL` pre-images (document store) / `OLD.tenant_id` (Postgres). Subscribing without tenant identity returns `401`.

### Beyond the database

Object keys, event topics, caches and logs are tenant-keyed, so isolation holds across the whole surface — not just SQL/document reads.

### Flows & MCP *(Preview)*

The AI-native capabilities ([Flows](/architecture/flows), [MCP](/architecture/mcp)) carry the same tenant boundary:

- **Flows** — every Temporal workflow id is `{tenantId}:{workspaceId}:{flowId}:{runUuid}`, generated **server-side** and **prefix-checked on every command** (start/signal/cancel/query); the shared namespace is isolated by server-stamped search attributes, so a cross-tenant id query is denied. Activity credentials are tenant-scoped, and the `http.request` activity is SSRF-guarded and strips platform credentials.
- **MCP** — access is per-tenant **OAuth 2.1** with **per-tool scopes** (Keycloak as the Authorization Server; read tools need a base scope, mutating tools their explicit scope). The management API and audit are keyed by the credential-derived `tenantId`, so a cross-tenant read/call/audit resolves to `404`; per-tenant quotas + rate limits (per server and per OAuth client) bound noisy neighbours; hosted MCP-server pods are **internal-only** (NetworkPolicy), reachable only via the gateway.

## Rate limiting & noisy-neighbour

APISIX `limit-count` uses `key_type: var_combination` with `$http_apikey`, giving **each API key its own bucket** (a plain `var` key would rate-limit globally across keys). Choose `policy: local` (node-local, ≈ N× the limit with N gateway replicas) or `policy: redis` (globally exact). Per-tenant quotas (from the plan's `quota_policy`) provide the higher-level resource limits.

## Secrets

Secrets come from **OpenBao** via the **External Secrets Operator**; the chart references secret *names*, not values. Sensitive material (e.g. the FerretDB/DocumentDB Postgres credentials behind `MONGO_URI`) is created as a Kubernetes Secret and mounted by reference — never inlined into manifests or values.

## Transport & SSRF safety

Public endpoints are TLS-terminated (`publicSurface.tls.mode`). The control plane's fallthrough proxy is **SSRF-safe by construction**: protocol/host/port are pinned to the operator-configured upstream and only the request path+query are forwarded, so a hostile request target cannot redirect it to an internal address.
