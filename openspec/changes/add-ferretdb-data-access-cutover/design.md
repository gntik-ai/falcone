## Context

Falcone's MongoDB data-access capability is composed of two layers:

1. **Plan builder** (`services/adapters/src/mongodb-data-api.mjs`): validates the incoming operation, applies `tenantId` injection via `applyTenantScopeToFilter`/`injectTenantIntoDocument` (the **authoritative** tenant boundary), builds the MongoDB command descriptor. Adapter-allowed aggregation stages: `$match`, `$project`, `$sort`, `$limit`, `$skip`, `$group`, `$unwind`, `$lookup` ≤1, `$count`, `$facet` ≤4, `$addFields`, `$set`, `$unset`, `$replaceRoot`, `$replaceWith`; `AGGREGATION_BLOCKED_STAGES` = `$out`, `$merge`, `$geoNear` (intentional **policy** — these stages are engine-functional on FerretDB but blocked by adapter allowlist). Transaction op paths currently declare `readConcern:'snapshot'` / `writeConcern:'majority'` which FerretDB cannot honor.

2. **Executor** (`apps/control-plane/src/runtime/mongo-data-executor.mjs`): receives a command plan and drives the `mongodb` driver. Connection URI is resolved at startup from `MONGO_URI` (or `MONGO_HOST`) in `apps/control-plane/src/runtime/main.mjs::mongoUri`.

The compatibility spike (ADR-14, `add-ferretdb-adr-spike`) confirmed on FerretDB 2.7.0 / postgres-documentdb 17-0.107.0-ferretdb-2.7.0:
- All 15 adapter-allowed aggregation stages are fully supported by the engine — no operator gap exists among permitted stages.
- `$facet≤4` and `$lookup≤1` caps are adapter policy, not engine constraints.
- Cross-DB `$lookup` is rejected by the engine (Location40321).
- Multi-document transactions are completely unsupported: `commitTransaction` → CommandNotFound(59); ops dispatched before commit **already persist** non-atomically; `abortTransaction` is a silent no-op (no rollback).
- `readConcern:'snapshot'` / `writeConcern:'majority'` are silently ignored.
- App-layer `tenantId` injection is the authoritative tenant boundary; per-tenant DocumentDB roles are complementary defense-in-depth.
- Startup order: DocumentDB engine first (healthcheck must pass), FerretDB gateway second (`depends_on` engine healthcheck).

## Goals / Non-Goals

**Goals:**

- `MONGO_URI` points at FerretDB; `mongo-data-executor.mjs` connects successfully and all basic CRUD/aggregation ops work.
- `readConcern:'snapshot'` and `writeConcern:'majority'` stripped from `mongodb-data-api.mjs` transaction paths — they are silently meaningless on FerretDB.
- Multi-document `transaction` ops are rejected **at the API boundary before any op runs** via `resolveMongoDataCapabilityCompatibility` with `supportsTransactions=false`; no lazy/commit-time probe (ops already persist before commit, abort is a no-op).
- `tests/env/docker-compose.yml` runs the FerretDB+DocumentDB stack with DocumentDB engine healthcheck gating the FerretDB gateway startup.
- Contract tests (`tests/contracts/mongodb-*.compatibility.test.mjs`) and adapter tests (`tests/adapters/mongodb-data-api.test.mjs`) remain green.
- App-layer `tenantId` injection via `applyTenantScopeToFilter`/`injectTenantIntoDocument` is the **authoritative** tenant boundary.
- Tenant-facing `/v1/collections/*` contract (request/response shapes, route paths) is unchanged.

**Non-Goals:**

- Change-stream or CDC paths — tracked in `add-ferretdb-realtime-cdc-remediation`.
- FerretDB engine/gateway deployment into kind/OpenShift — tracked in `add-ferretdb-documentdb-engine` and `add-ferretdb-gateway`.
- Per-tenant DocumentDB credential provisioning — tracked in `add-ferretdb-tenant-isolation-credentials`.
- Adding new tenant-facing routes.

## Decisions

**Decision 1: No new unsupported-operator shim is needed.**

The spike proved all 15 adapter-allowed aggregation stages are fully supported by FerretDB 2.7.0. The invented `FERRETDB_UNSUPPORTED_OPERATOR` error code and shim are DROPPED. The existing `AGGREGATION_BLOCKED_STAGES` allowlist ($out, $merge, $geoNear) is retained unchanged; it is annotated as intentional **policy** (the engine accepts these stages but Falcone blocks them by design). The $facet≤4 / $lookup≤1 caps are also adapter policy. No open question remains about $facet sub-pipeline or $lookup within-DB divergence — none exists.

**Decision 2: Transaction op rejected at API boundary before any op runs.**

`commitTransaction` → CommandNotFound(59) on FerretDB; ops dispatched before commit already persist non-atomically; `abortTransaction` is a silent no-op. A lazy/commit-time 501 guard is therefore insufficient — partial writes are already committed when the guard fires. Instead, `resolveMongoDataCapabilityCompatibility` SHALL expose `supportsTransactions=false` when the backend is FerretDB, and the plan builder SHALL reject `transaction` op at the API boundary (before any individual op is dispatched), returning HTTP 501 with `code: "TRANSACTION_NOT_SUPPORTED"`.

Alternatives considered: lazy probe at first `commitTransaction` call. Rejected — individual ops within the transaction already persist before commit; abort is a no-op so there is no rollback path.

**Decision 2a: Strip snapshot/majority read/write concerns.**

`mongodb-data-api.mjs` currently attaches `readConcern:'snapshot'` and `writeConcern:'majority'` to transaction ops. FerretDB silently ignores these, so carrying them forward creates a false guarantee. They SHALL be stripped (or omitted) on FerretDB-targeted builds. A dedicated task tracks this.

**Decision 3: `tests/env/docker-compose.yml` replaces `mongo:7` with FerretDB+DocumentDB stack; engine-first startup order.**

The DocumentDB engine (`postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) provides the Postgres backend; the FerretDB gateway (`ferretdb:2.7.0`) exposes the wire protocol. Both services are added to docker-compose; the `mongo` service is replaced. The FerretDB gateway listens on port 57017 (same external port as the replaced `mongo:7` mapping). The gateway service MUST declare `depends_on` with a healthcheck condition on the DocumentDB engine — the engine must be healthy before the gateway starts.

**Decision 4: App-layer `tenantId` injection is the authoritative tenant boundary.**

`applyTenantScopeToFilter`/`injectTenantIntoDocument` in `mongodb-data-api.mjs` inject the verified `tenantId` predicate into every query and document write. This is the **primary, authoritative** isolation boundary. Per-tenant DocumentDB database/role credentials (introduced in `add-ferretdb-tenant-isolation-credentials`) are complementary defense-in-depth. The framing is reversed from the earlier draft: app-layer injection is NOT "defense-in-depth alongside" the role boundary — it IS the boundary.

**Decision 5: No route or schema changes.**

`services/gateway-config/public-route-catalog.json` is NOT modified. All `/v1/collections/*` request and response shapes are preserved. The cutover is invisible to tenants.

## Risks / Trade-offs

- [Risk: FerretDB $lookup or $facet correctness divergence] → RESOLVED by spike: no divergence found within the adapter-allowed caps ($lookup≤1, $facet≤4). Cross-DB $lookup is rejected by the engine (Location40321) and is already not permitted by the adapter. No shim needed.
- [Risk: Transaction partial writes on FerretDB (abort is a no-op)] → Mitigation: transaction op is rejected at the API boundary before any individual op runs, via `supportsTransactions=false` in `resolveMongoDataCapabilityCompatibility`. No op is ever dispatched.
- [Risk: Silent snapshot/majority concern on FerretDB creates false guarantees] → Mitigation: concerns are stripped in the plan builder before dispatch; a dedicated task tracks the removal.
- [Risk: docker-compose stack change breaks existing test env setup] → Mitigation: FerretDB is wire-compatible and listens on the same port (57017); the MONGO_URI change is the only env delta; DocumentDB engine initialization is idempotent; gateway `depends_on` engine healthcheck prevents premature connection.
- [Risk: Change-stream-dependent tests fail on FerretDB (no change streams)] → Mitigation: change-stream paths are explicitly out of scope; `add-ferretdb-realtime-cdc-remediation` tracks remediation; tests that require change streams are skipped or deferred to that change.

## Migration Plan

1. Merge `add-ferretdb-adr-spike` (#455 / ADR-14): compatibility matrix confirmed — all adapter-allowed stages supported; transaction unsupported; snapshot/majority silently ignored. (Already merged.)
2. Merge `add-ferretdb-gateway` (#456): FerretDB gateway images available.
3. Merge `add-ferretdb-tenant-isolation-credentials` (#458): per-tenant DocumentDB credentials provisioned (defense-in-depth; app-layer tenantId injection remains authoritative).
4. Merge this change: repoint `MONGO_URI`; strip snapshot/majority concerns; add API-boundary transaction guard (`supportsTransactions=false`); update docker-compose with engine-first startup order.
5. Run `bash tests/blackbox/run.sh` + `tests/contracts/mongodb-*.compatibility.test.mjs` + `tests/env/executor/mongo-data-executor.test.mjs` against FerretDB stack.
6. Rollback: revert `MONGO_URI` to `mongo:7` URI and revert docker-compose; the transaction boundary guard and concern-stripping are additive and do not affect MongoDB 7 behavior.

## Open Questions

_(none — all open questions closed by ADR-14 spike)_

- $facet sub-pipeline restrictions beyond count-4: **CLOSED** — no engine restriction found; the ≤4 cap is adapter policy.
- $lookup within-DB vs cross-DB divergence: **CLOSED** — within-DB $lookup works; cross-DB is rejected by the engine (Location40321) and was never permitted by the adapter.
