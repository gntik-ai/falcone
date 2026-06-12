## Context

The control-plane executor (`apps/control-plane/src/runtime/server.mjs`) follows a consistent pattern: each capability is a named executor module (e.g., `mongo-data-executor.mjs`, `events-executor.mjs`) instantiated in `main.mjs` and threaded through `createControlPlaneServer` → `buildRoutes` as a dependency. The route table is a flat array of `[method, RegExp, handler, opts?]` tuples; routes are matched in order. Identity is resolved by `resolveIdentity` (API key → JWT → gateway headers, fail-closed) and the derived `tenantId` is never overridable by the request body.

The system has no existing flows API. Temporal infrastructure is being introduced by #356 (namespace/connection model, search attributes, tenant context injection). The current `main.mjs` does not import any Temporal client; that import belongs exclusively in the new `flow-executor.mjs`.

Storage for flow definitions and versions follows the pattern in `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql`: `tenant_id` + `workspace_id` columns, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, policies using `current_setting('app.tenant_id', true)` / `current_setting('app.workspace_id', true)`, and `GRANT … TO falcone_app`. The tenant RLS GUCs are set per-transaction by the registry's `withWorkspaceClient` helper (`apps/control-plane/src/runtime/connection-registry.mjs::withWorkspaceClient`).

Public route catalog entries follow the shape documented by the first route in `services/internal-contracts/src/public-route-catalog.json`: every field (including `gatewayRouteClass`, `tenantBinding`, `workspaceBinding`, `scope`, `downstreamService`, etc.) must be populated; the catalog is regenerated via `scripts/generate-public-api-artifacts.mjs` from the OpenAPI document.

## Goals / Non-Goals

**Goals:**

- Introduce `flow-executor.mjs` as the sole holder of a Temporal client connection in the control-plane process.
- Register all flows routes in `buildRoutes()` when a `flowExecutor` is injected; leave existing routes and the fall-through proxy behaviour untouched when it is absent.
- Persist flow definitions (draft head) and flow versions (immutable) in Postgres with RLS enforced for `falcone_app`; migrations are idempotent and safe to re-run.
- Gate every Temporal operation on a `{tenantId}:` prefix check so cross-tenant Temporal access is structurally impossible.
- Add all flows routes to `public-route-catalog.json` with correct `gatewayRouteClass` (`control` for definition management, `data-control` for execution operations) and regenerate downstream artifacts.

**Non-Goals:**

- Trigger registration internals (sibling change #365).
- SSE streaming of execution events (sibling change #366).
- Per-tenant quotas and audit logs for flows (sibling change #362).
- DSL interpreter Temporal worker implementation (sibling change #359).
- Web console UI for the flow designer or monitoring (sibling changes #363, #364).
- Temporal namespace provisioning (covered by #356).

## Decisions

**D1 — One Temporal client, in `flow-executor.mjs`**

Centralising the Temporal client in a single module (rather than creating connections in each route handler) mirrors how `mongo-data-executor.mjs` owns the MongoDB connection and `events-executor.mjs` owns the Kafka producer. It makes connection lifecycle management (startup, shutdown, health) explicit and prevents accidental duplication. `main.mjs` constructs the executor and passes it into the server; if `TEMPORAL_ADDRESS` is unset, the executor is `undefined` and flows routes are omitted (same pattern as `FN_BACKEND=off` for functions).

**D2 — Workflow ID format: `{tenantId}:{workspaceId}:{flowId}:{runUuid}`**

Encoding tenant and workspace into the workflow ID makes cross-tenant isolation enforceable without a database lookup on every Temporal API call: the executor strips and validates the prefix before forwarding any Temporal command. The `:` separator is chosen because Temporal allows it and UUIDs do not contain it. Clients never supply workflow IDs; the server always generates the `runUuid` with `crypto.randomUUID()`.

**D3 — Temporal visibility search attributes for execution list**

Using Temporal's search attribute index (typed attributes `tenantId`, `workspaceId`, `flowId`, `flowVersion`) for list queries avoids maintaining a separate Postgres execution log for the query path. The `tenantId` filter is always injected server-side from the verified identity and is not overridable by query parameters. This decision is consistent with the search-attribute model established in #356.

**D4 — Version pinning at execution-start time**

The `version` parameter on `POST …/executions` is resolved to a `flow_versions` row at start time; the Temporal workflow receives the full definition JSON as input. Subsequent publishes do not patch running workflows because each execution carries its own frozen copy of the definition. This avoids the complexity of mid-flight definition hot-swap and matches how production workflow engines handle versioning.

**D5 — Publish pipeline validates before freezing**

`POST …/flows/{flowId}/versions` runs the same validation logic as the explicit validate endpoint before writing the `flow_versions` row. The 422 response with node-scoped error codes is identical in both paths. This is a deliberate duplication of the validation call (not shared state) so publish is always self-consistent even if the client skips the validate step.

**D6 — `flow_versions` immutability enforced at DB level**

The RLS policy for `flow_versions` grants `SELECT, INSERT` to `falcone_app` but NOT `UPDATE` or `DELETE`, ensuring immutability is a database constraint, not merely an API convention. This mirrors the `workspace_openapi_versions` pattern in `services/openapi-sdk-service/migrations/088-workspace-openapi-versions.sql` (no UPDATE grant on versioned rows).

**D7 — `gatewayRouteClass` split: `control` vs `data-control`**

Definition management (CRUD, validate, publish, version list/get) is low-frequency structural work performed by workspace admins/owners → `gatewayRouteClass: "control"`. Execution operations (start, list, detail, cancel, retry, signal) are higher-frequency runtime calls that may be issued by service accounts → `gatewayRouteClass: "data-control"`. This matches the existing split between `postgres` DDL (`control`) and `postgres` data rows (`data-control`).

## Risks / Trade-offs

**[Temporal client unavailability at startup]** → `flow-executor.mjs` wraps the Temporal client connection in a lazy-connect pattern (connect on first use, not at module load) so the control-plane process starts successfully even when Temporal is temporarily unreachable. Route handlers return HTTP 503 with `code: TEMPORAL_UNAVAILABLE` while the client is disconnected.

**[Visibility query latency]** → Temporal visibility indexing is eventually consistent; newly started executions may not appear in list results for up to a few seconds. The spec does not guarantee strong read-after-write consistency for the list endpoint. Clients that need immediate confirmation of a started execution should use the `executionId` returned by the start response.

**[`flow_versions` SELECT + INSERT only for `falcone_app`]** → Migration tooling (which runs as superuser or BYPASSRLS) retains full access. Any legitimate administrative cross-tenant sweep must use the admin connection path (`withAdminClient`), not the application role.

**[Signal allowlist depends on published DSL version]** → The signal validation step requires fetching the `flow_versions` row to extract signal definitions. If the published version's `definition_json` is malformed, the signal endpoint falls back to rejecting the request with 422 rather than forwarding an unvalidated signal name to Temporal.

## Migration Plan

1. Add migration files for `flow_definitions` and `flow_versions` tables (idempotent `CREATE TABLE IF NOT EXISTS`) with RLS policies and `GRANT … TO falcone_app`, following `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql`.
2. Implement `flow-executor.mjs`; wire into `main.mjs` behind `TEMPORAL_ADDRESS` env guard.
3. Extend `buildRoutes()` and `createControlPlaneServer` signature.
4. Add flows route entries to `public-route-catalog.json` and run `scripts/generate-public-api-artifacts.mjs`; commit the generated artifacts.
5. Run black-box suite (`tests/blackbox/run.sh`) and contract/integration/unit suite (CI `quality` job).
6. Real-stack tests (`tests/env/`) against a pgvector-capable Postgres image verify RLS: `falcone_app` cannot read cross-tenant flow rows.

**Rollback**: `TEMPORAL_ADDRESS` unset removes all flows routes without code change. The `flow_definitions` and `flow_versions` tables are additive; removing them requires a DROP migration, which is safe because no other capability depends on them.

## Open Questions

- **OQ1**: Should `flow_definitions` and `flow_versions` live in the same Postgres database as the scheduling-engine tables or in a dedicated metadata pool alongside `api_keys` / `embedding_providers`? (No blocking decision for this change; using `keyPool` in `main.mjs` is the path of least resistance until a dedicated flow-metadata service emerges.)
- **OQ2**: What is the exact Temporal search attribute type (`Keyword` vs `Text`) for `flowId` and `flowVersion`? Needs alignment with #356 before the execution-list query is implemented.
- **OQ3**: The signal `signalName` allowlist — should it be derived from the draft head or from the pinned published version of the execution? (Current spec says the published version; confirm with #358 DSL owners.)
