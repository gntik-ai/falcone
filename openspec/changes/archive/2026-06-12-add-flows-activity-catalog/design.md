## Context

Falcone's workflow engine (epic #355) needs to call the platform's own data, storage, functions, events, and outbound-HTTP surfaces from inside a Temporal workflow. These calls must run under the executing tenant's identity — never a shared platform credential — to maintain tenant isolation guarantees that the rest of the platform upholds via RLS (`apps/control-plane/src/runtime/postgres-data-executor.mjs`, lines 105–204) and workspace-prefix topic isolation (`events-executor.mjs::physicalTopic`).

The webhook engine already solved the outbound-HTTP SSRF problem with `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` and delivery-time DNS-rebinding re-validation (`services/webhook-engine/actions/webhook-delivery-worker.mjs`). The activity catalog reuses that guard rather than re-implementing it.

`apps/control-plane/src/runtime/api-keys.mjs::issueKey` can mint short-lived `flc_service_…` keys (`key_type = 'service'`, `dbRole = 'falcone_service'`) scoped to a `(tenantId, workspaceId)` pair. This is the credential model for activity execution; the precise minting/expiry runtime is co-designed with `add-flows-tenancy-isolation-limits` (#362).

## Goals / Non-Goals

**Goals:**
- Define and implement the six first-party task-type activities (`db.query`, `storage.put`, `storage.get`, `functions.invoke`, `events.publish`, `http.request`, `email.send` stub) in `services/workflow-worker/src/activities/`.
- Build the task-type registry as the authoritative extension point for activity lookup, schema validation, and palette generation.
- Carry tenant-scoped short-lived API key credentials into every activity invocation; never use static platform credentials.
- Reuse `isBlockedIp` from `webhook-engine` for SSRF guard parity without code duplication.
- Classify failures retryable vs non-retryable and enforce payload size limits.

**Non-Goals:**
- Implementing the Temporal worker shell, workflow interpreter, or scheduler (owned by `add-flows-dsl-interpreter-worker`).
- Defining the credential minting lifecycle, key storage, or expiry enforcement (owned by `add-flows-tenancy-isolation-limits`).
- Defining the DSL JSON Schema or workflow definition persistence (owned by `add-flows-dsl-schema`).
- Introducing a real platform email service (no SMTP capability exists; `email.send` is a stub only).
- Per-tenant outbound IP allowlists for `http.request` (future follow-up).

## Decisions

**D1 — Activities call the platform through its existing executor surface, not via HTTP to the running control-plane.**
Rationale: the executor functions (`executePostgresData`, `executeFunctions`, `executeMongoData`, etc.) are importable Node modules. Calling them directly avoids a network hop, an extra auth round-trip, and the need to locate the control-plane service address from inside the worker. The executor surface is already stable and tested.
Alternative considered: HTTP to `/v1/…` routes. Rejected — more moving parts, requires service discovery, adds latency, and re-introduces the credential-passing problem over the wire.

**D2 — SSRF guard is imported from `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp`.**
Rationale: the guard is already production-hardened (RFC 1918, loopback, link-local, decimal encoding, IPv6 link-local) and tested by `tests/blackbox/webhook-ssrf-guard.test.mjs`. Sharing the module keeps the two codepaths in sync. The activity additionally performs a DNS-rebinding re-check at execution time, mirroring the pattern in `webhook-delivery-worker.mjs`.
Alternative considered: copy the logic into the activity. Rejected — diverges over time, doubles maintenance.

**D3 — Task-type registry is a plain `Map<string, { activity, inputSchema, outputSchema }>` initialized at worker startup.**
Rationale: simple, synchronous, and zero-dependency. The registry does not need persistence because it is derived from code, not user data.
Alternative considered: a database-backed registry. Rejected for built-in task types — unnecessarily complex; extensible via the map for future plugin patterns.

**D4 — Payload size is enforced in a shared `assertPayloadSize` guard called at the start of every activity and before returning output.**
The 2 MiB limit matches Temporal's recommended `maxPayloadSize` for blob payloads and avoids Temporal worker OOM under hostile input.

**D5 — `email.send` is a registered stub returning `CAPABILITY_UNAVAILABLE`.**
Rationale: no SMTP service exists anywhere in `services/` or `apps/` (confirmed by `grep -rli smtp services/ apps/`). Registering a stub keeps the registry complete and lets DSL validation and the palette surface the task type name while making the limitation explicit and fail-fast rather than silently missing.

**D6 — Error classification table per task type.**

| Error condition | Task types | Classification |
|---|---|---|
| Network timeout / connection refused | all | retryable |
| HTTP 429 / 503 from platform | all | retryable |
| Kafka broker unavailable | `events.publish` | retryable |
| HTTP 4xx (except 429) from platform | all | non-retryable |
| SSRF blocked | `http.request` | non-retryable |
| `PAYLOAD_TOO_LARGE` | all | non-retryable |
| Schema / table not found | `db.query` | non-retryable |
| Function not found | `functions.invoke` | non-retryable |
| Object not found | `storage.get` | non-retryable |
| Auth / credential error | all | non-retryable |
| `CAPABILITY_UNAVAILABLE` | `email.send` | non-retryable |

## Risks / Trade-offs

[Risk: Direct executor import couples worker to control-plane internal modules] → Mitigation: import paths are stable published symbols; add an integration test that catches breakage at CI time.

[Risk: SSRF guard import creates a cross-service module dependency] → Mitigation: `isBlockedIp` is a pure function with no side effects; extract to a shared `services/internal-contracts/src/ssrf-guard.mjs` if the dependency causes packaging issues at deploy time.

[Risk: Short-lived credential minting not yet fully designed (#362 in-flight)] → Mitigation: the activity layer accepts a `credential` parameter injected by the caller (the Temporal activity context); the minting implementation is a drop-in. Activities do not resolve credentials themselves — they receive them.

[Risk: Temporal blob limit diverges from the 2 MiB constant in code] → Mitigation: define the constant in a single shared location (`services/workflow-worker/src/activities/limits.mjs`) so it can be updated once.

## Migration Plan

This change introduces new files only (`services/workflow-worker/src/activities/`). No existing tables, routes, or modules are modified. Deployment order:
1. Deploy `services/workflow-worker/` with the activity modules and registry.
2. Sibling changes (#358, #362) wire the registry into DSL validation and credential minting.

Rollback: remove the `services/workflow-worker/` deployment; no data migration required.

## Open Questions

1. Should `isBlockedIp` be extracted to `services/internal-contracts/` immediately, or imported directly from `webhook-engine`? Decision deferred to implementation; the spec requires functional parity, not a specific import path. **Resolved at apply time**: imported directly from `services/webhook-engine/src/webhook-subscription.mjs` via a relative path that is stable across `src/` and `dist/`; no extraction needed yet.
2. Exact key TTL for the execution-scoped `flc_service_…` credential: co-designed with #362; placeholder of 15 min used in tests. The activity layer CONSUMES an injected `credential` (it never mints one); minting/expiry remains #362's.

## Implementation deviations (recorded at apply)

**ID1 — Catalog authored as native ESM `.mjs`, bridged into the CJS worker.** `workflow-worker`
is TypeScript + CommonJS by a hard Temporal SDK constraint. Authoring the catalog as `.mjs`
keeps it directly importable by the `node --test` unit/black-box suites (no build) and lets each
activity import the CJS `@temporalio/activity` via interop. `index.ts` `executeTask` loads the
catalog at runtime via a real dynamic `import()` (a `new Function` indirection so tsc does not
rewrite it to `require()`); a build step copies the `.mjs` into `dist/` for the Temporal harness.

**ID2 — Dispatch falls back to the interpreter echo seam for UNREGISTERED task types.** The
registry is authoritative for FLW-E006 and `resolveActivity` fails closed with
`UNKNOWN_TASK_TYPE`, but `dispatchTask` must not break the upstream interpreter harness, which
exercises graph-walking with placeholder task types (`fetch-record`, `noop-a`, …). Production
definitions cannot reach the worker with an unknown type (FLW-E006 rejects them at the API first,
verified: validate → 422 / FLW-E006). Payload-size + tenant guards still run for every type.

**ID3 — `storage.put` / `storage.get` use an injected HTTP client.** Storage has no importable
control-plane executor (it is served over the HTTP API / proxied), so the storage activities call
the `uploadStorageObject` / `downloadStorageObject` routes over an injected fetch-shaped client.
D1's direct-executor-import decision applies to `db.query` / `events.publish` / `functions.invoke`.

**ID4 — Validate-endpoint wiring consumes a Temporal-FREE name list.** `apps/control-plane/.../main.mjs`
imports `TASK_TYPE_NAMES` from the worker's `catalog-names.mjs` (pure data, no `@temporalio/*`)
and passes it as `createFlowExecutor({ taskTypeCatalog })`, so the control-plane process never
loads the Temporal SDK that lives only in the worker's `node_modules`.
</content>
</invoke>