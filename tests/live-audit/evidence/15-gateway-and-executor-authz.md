# Evidence — Gateway edge + systemic executor authorization (TOP-PRIORITY isolation)

## GW-1 (CRITICAL) — public, UNAUTHENTICATED cross-tenant impersonation via the gateway

The public ingress routes `api.dev.in-falcone.example.com → falcone-apisix` and
`realtime.dev.in-falcone.example.com → falcone-apisix` (nginx Ingress `falcone-in-falcone-public`).
The live **standalone APISIX** (`falcone-apisix-standalone` ConfigMap, 30 routes) carries **only
`cors` + `proxy-rewrite` plugins — NO `openid-connect`/`jwt-auth`/`key-auth`** and **no rule that
strips client-supplied `x-tenant-id`/`x-workspace-id`**. Config comment is explicit:
"the gateway does not inject x-tenant-id, so the executor is the auth authority here."
The executor's `resolveIdentity` (server.mjs) falls back to `identityFromHeaders` (trusts
`x-tenant-id`/`x-workspace-id`) when no JWT/API-key is presented.

**Live proof — through APISIX (`:9080`), no Authorization header, spoofed `x-tenant-id`:**

```
POST http://<apisix>/v1/workspaces/<A_ws>/api-keys
  -H 'x-tenant-id: <A_tenant>' -H 'x-workspace-id: <A_ws>'   (NO auth)
  -> 201  {"key":"flc_service_…","keyType":"service"}        # minted a real key for Tenant A
GET  http://<apisix>/v1/workspaces/<A_ws>/api-keys -H 'x-tenant-id: <A_tenant>'
  -> 200  {items:[…A's keys…]}                               # listed A's keys
GET  (same) WITHOUT x-tenant-id -> 401 UNAUTHENTICATED "Missing tenant identity"
```

So **any party that can reach the gateway can impersonate any tenant by setting one header** — no
credentials — and then mint keys / read+write that tenant's data-plane. (Test key was revoked.)
kindnet does not enforce NetworkPolicy, so the executor is also directly reachable in-cluster.

## AUTHZ-1 (CRITICAL, systemic) — handlers authorize by URL path identifier, not by credential

Across the data plane, the workspace/database/bucket is taken from the **URL path**, and the
service never asserts that it belongs to the authenticated principal
(`identity.workspaceId === path.workspaceId`). Proven independently on three surfaces with REAL,
correctly-scoped Tenant-B credentials operating on Tenant-A resources:

| Surface | Mechanism | Proof |
|---|---|---|
| Postgres (PG-1) | shared `in_falcone` DB (resolveConnection ignores ws) + shared `falcone_service` role + no RLS on user tables | B's key read **and wrote and deleted** A's `secrets` rows (HTTP 200/201/200) |
| Events/Functions (FE-1) | `runEvents/runFunctions({workspaceId: <path ws>})`; no identity↔path check | B's key listed/consumed/**published** A's Kafka topics and invoked A's function |
| Storage (STOR) | `storage-handlers.mjs listObjects(ctx.params.bucketId)` / `workspaceUsage(ctx.params.workspaceId)` never reference `identity.tenantId` | any authed caller lists/reads any bucket/workspace by id (source-confirmed); single shared SeaweedFS key reads every tenant's objects |

Partial mitigation that exists only for Mongo: the Mongo executor injects `identity.tenantId` into
the query filter, so document **reads** are tenant-filtered (no read leak) — but the `{db}` path is
still caller-controlled and tenants co-mingle in one physical collection. The inconsistency proves
the boundary is per-handler and incomplete, not enforced centrally.

## Root causes (for fixes)

1. Gateway (APISIX) does not authenticate or strip client tenant-context headers; the standalone
   config lacks the OIDC/JWT plugins the design assumes ("executor is the auth authority").
2. Executor `resolveIdentity` trusts `x-tenant-id` headers as a fallback (intended for a trusted
   gateway that strips them — which this gateway does not).
3. Data-plane handlers use the path `{workspaceId}`/`{databaseName}`/`{bucketId}` as the authority
   instead of the credential-bound workspace; no `identity.workspace === path.workspace` assertion.
4. Postgres: `resolveConnection = () => ({ dsn })` collapses all workspaces into shared `in_falcone`;
   user tables created via the DDL API get no RLS and no tenant scoping.

## Net

Tenant isolation — the cardinal requirement for a multitenant BaaS — is **not enforced** on the
live deployment. Cross-tenant read/write/delete is demonstrated on Postgres, Events, Functions and
Storage, and an **unauthenticated** attacker can impersonate any tenant through the public gateway.
