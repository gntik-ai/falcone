# FerretDB v2 + DocumentDB compatibility spike — findings

Empirical findings for the MongoDB → FerretDB migration decision (ADR-14). Every
classification below was produced by executing the operation against a **live**
FerretDB 2.7.0 / DocumentDB 0.107 instance over the MongoDB wire protocol (Node
`mongodb` driver) and over `psql` at the Postgres layer. The reproducible harness and
raw JSON results are attached under `evidence/`.

## Version pair under test (pinned)

| Component | Image | Digest |
| --- | --- | --- |
| Gateway | `ghcr.io/ferretdb/ferretdb:2.7.0` | `sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985` |
| Engine | `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0` | `sha256:2386795ec2aa7ae559304361979f1dc5708d383ee9020ae63dadc2940dfe58f7` |

- **Wire compatibility**: `hello` → `ok:1`, `isWritablePrimary:true`, `maxWireVersion:21`
  (MongoDB 7.0 wire level); `buildInfo.version = 7.0.77`, `buildInfo.ferretdb = v2.7.0`.
- **Engine**: PostgreSQL **17.6**; `shared_preload_libraries = pg_cron,pg_documentdb_core,pg_documentdb`;
  `cron.database_name = postgres`.
- **Bundled engine extensions**: `documentdb 0.107-0`, `documentdb_core 0.107-0`,
  `pg_cron 1.6`, `postgis 3.6.0`, `rum 1.3`, **`vector 0.8.1` (pgvector)**, `tsm_system_rows 1.0`.

## Upgrade order (finding)

**Engine first (`postgres-documentdb`), then gateway (`ferretdb`).** Validated: the engine
container reached `healthy` (extensions preloaded, DocumentDB API schema present), and only
then did the gateway start and complete its first wire handshake. Rationale: the
`pg_documentdb_core`/`pg_documentdb` libraries are loaded via `shared_preload_libraries`
(server-start only, not session-settable) and the `documentdb_api` schema must exist before
the FerretDB gateway opens a connection; gateway-first fails the first handshake.

## 1. Aggregation stage matrix (task 2)

Stages allowed by `services/adapters/src/mongodb-data-api.mjs` (`AGGREGATION_ALLOWED_STAGES`):

| Stage | Classification | Evidence (live) |
| --- | --- | --- |
| `$match` | SUPPORTED | filtered to 2 rows |
| `$project` | SUPPORTED | projected `{_id,category,qty}` |
| `$sort` | SUPPORTED | ordered by `qty` |
| `$limit` | SUPPORTED | window honored |
| `$skip` | SUPPORTED | offset honored |
| `$group` | SUPPORTED | `{_id:'x', total:5}` |
| `$unwind` | SUPPORTED | array → 5 rows |
| `$lookup` (≤1) | SUPPORTED | same-db join populated `joined[]` |
| `$count` | SUPPORTED | `{n:3}` |
| `$facet` (≤4) | SUPPORTED | all 4 branches resolved in one pass |
| `$addFields` | SUPPORTED | `computed:3` |
| `$set` | SUPPORTED | field added |
| `$unset` | SUPPORTED | field removed |
| `$replaceRoot` | SUPPORTED | new root document |
| `$replaceWith` | SUPPORTED | new root document |

**No PARTIAL entries** — all 15 allowed stages match MongoDB 6.0+ semantics within Falcone's
already-constrained bounds (`$facet` ≤4 branches, `$lookup` ≤1 stage).

`$group` with `$sum`/`$avg` over **mixed int+double** (`[1, 2.5, 3, 4.5]`): **SUPPORTED** —
`sum=11`, `avg=2.75` (exact, matches MongoDB).

### Blocked stages (task 2.3) — engine accepts them; Falcone blocks at the adapter

The task expected `$out`/`$merge`/`$geoNear` to be *rejected* by FerretDB. **They are not.**

| Stage | Engine behavior | Net effect for Falcone |
| --- | --- | --- |
| `$out` | **SUPPORTED** — materialized 2 docs into target collection | Blocked by `AGGREGATION_BLOCKED_STAGES` (adapter) — unchanged |
| `$merge` | **SUPPORTED** — materialized 2 docs into target collection | Blocked by `AGGREGATION_BLOCKED_STAGES` (adapter) — unchanged |
| `$geoNear` | **SUPPORTED** with a `2dsphere` index (2 rows); `IndexNotFound` (27) only when no geo index exists | Blocked by `AGGREGATION_BLOCKED_STAGES` (adapter) — unchanged |

Finding: the three "blocked" stages are functional on FerretDB 2.7; Falcone's block is a
**policy allowlist in the adapter**, not an engine limitation. No engine wire-rejection code
to record for `$out`/`$merge`; `$geoNear` returns `IndexNotFound (27)` absent a geo index.

## 2. Index matrix (task 3)

| Index type | Classification | Evidence (live) |
| --- | --- | --- |
| Single-field | SUPPORTED | `a_1` created |
| Compound | SUPPORTED | `a_1_b_-1` created |
| Unique | SUPPORTED | collision on insert → **code `11000`** (duplicate key) |
| Sparse | SUPPORTED | unique+sparse: two docs missing the field coexist (sparse excludes them) |
| TTL | SUPPORTED | expired doc **purged in ~45s** (pg_cron monitor); non-expiring doc retained |
| Text | **SUPPORTED (bonus)** | `body_text` created; `$text` search returns 1 hit (backed by `rum`) |
| Geo `2dsphere` | **SUPPORTED (bonus)** | `loc_2dsphere` created; `$geoNear` returns rows (backed by `postgis`) |

Finding: text and `2dsphere` geo indexes — assumed UNSUPPORTED in the task — are **fully
functional** at this version because the engine bundles `rum` and `postgis`. Falcone's adapter
does not expose them today, but they are not blockers.

## 3. Multi-document transaction gap (task 4) — UNSUPPORTED

| Command | Classification | Wire evidence |
| --- | --- | --- |
| `commitTransaction` | **UNSUPPORTED** | `CommandNotFound (59)` — `no such command: 'commitTransaction'`; the in-transaction write **persisted anyway** (no atomicity, no rollback) |
| `abortTransaction` | **UNSUPPORTED (silent no-op)** | command accepted, but the in-transaction write was **NOT rolled back** (`docPersisted=true`) — `abort` does not abort |

`mongodb-data-api.mjs` declares transaction ops with `readConcern:'snapshot'` /
`writeConcern:'majority'` (`MONGO_DATA_DEFAULT_TRANSACTION_LIMITS`). Neither isolation level
can be honored: there is no transaction boundary at all — writes auto-commit immediately and
`abort` cannot undo them. **Multi-document transactions are UNSUPPORTED.**

**Remediation → SHIM to single-operation semantics** (owner: data-api migration child).
DocumentDB guarantees single-document atomicity, so the `transaction` op must be downgraded to
ordered single-doc operations; true multi-doc atomic requests must be rejected up-front via the
existing `resolveMongoDataCapabilityCompatibility({operation:'transaction', topology.supportsTransactions:false})`
path (returns `mongo_data_capability_unavailable`, 409). Alternative: drop the op. Rationale:
silently degrading to non-atomic writes is unsafe (the abort no-op proves writes leak), so the
gap must be made explicit at the API boundary rather than relied upon.

## 4. Change-stream gap (task 5) — UNSUPPORTED (highest severity)

| Operation | Classification | Wire evidence |
| --- | --- | --- |
| `collection.watch()` — realtime-executor pipeline (`$match` on `fullDocument.tenantId` / `fullDocumentBeforeChange.tenantId`) | **UNSUPPORTED** | `CommandNotSupported (115)` — `Stage $changeStream is not supported yet in native pipeline` |
| `collection.watch()` — CDC bridge pipeline (`resumeAfter`/`startAtOperationTime`) | **UNSUPPORTED** | `CommandNotSupported (115)` — same |
| `db.command({collMod, changeStreamPreAndPostImages:{enabled:true}})` | **UNSUPPORTED** | `UnknownBsonField (40415)` — `BSON field 'collMod.changeStreamPreAndPostImages' is an unknown field` |

Both change-stream consumers are structurally blocked:
- `apps/control-plane/src/runtime/realtime-executor.mjs` — `subscribe()` calls
  `collection.watch(pipeline, {fullDocument:'updateLookup', fullDocumentBeforeChange:'whenAvailable'})`
  and `collMod changeStreamPreAndPostImages`. Both fail.
- `services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs` — `_run()` calls
  `collection.watch(pipeline, {resumeAfter, startAtOperationTime})` and iterates with
  `for await`. Fails at stream open.

**Remediation → RE-ARCHITECT via Postgres logical replication** (owners: realtime-executor
child + CDC bridge child). No native-wire shim exists at 2.7.0 / 0.107 — **escalated**. The
DocumentDB documents are stored as rows in the `documentdb_data` schema of the single backing
Postgres database, so a **logical replication slot + `pgoutput`** (or a trigger-based outbox on
those tables) can substitute for change streams; **`REPLICA IDENTITY FULL`** on the
`documentdb_data` tables substitutes for `changeStreamPreAndPostImages` (delivers the prior row
image needed to tenant-scope deletes on `fullDocumentBeforeChange.tenantId`). Caveat: the slot
emits DocumentDB's internal BSON row format, so the bridge must decode that format — a
non-trivial re-architecture, not a drop-in. Until built, the realtime and CDC capabilities are
gated.

## 5. Per-tenant DocumentDB tenancy spike (task 7)

**Database mapping (finding).** DocumentDB does **NOT** create a Postgres-database-per-tenant.
All Mongo "databases" live inside the **single** backing Postgres database (`postgres`), in the
shared `documentdb_data` schema, catalogued by a `database_name` column in
`documentdb_api_catalog.collections` (verified: `tenant_a`, `tenant_b`, `falcone_spike` all
coexist in one Postgres DB). A FerretDB "database" is a **logical namespace**, not a Postgres
isolation boundary.

**Cross-namespace query isolation.** Cross-database `$lookup` (`from:{db,coll}`) is **rejected**
— `Location40321` (`'from' must be a string`). FerretDB 2.7 supports only same-database joins,
so an aggregation cannot read across tenant databases.

**Role / auth mapping.** `db.runCommand({createUser, roles:[{role:'readWrite', db:'tenant_a'}]})`
→ `ok:1` and provisions a **real Postgres login role** (`tenant_a_user`, `LOGIN`,
non-superuser, **non-BYPASSRLS**). The FerretDB gateway authenticates that role's credentials
(`authSource=tenant_a`) over the wire — credential injection works.

**⚠ Isolation gap (critical).** A user created with `readWrite` scoped to `tenant_a`
**successfully read `tenant_b`** (`crossTenantRead.count = 1`). **DocumentDB 0.107's
per-database role scoping is NOT enforced as an isolation boundary** — any authenticated
principal can read any Mongo database in the instance. Therefore "real per-tenant databases and
roles" (epic decision D3) does **not**, at this version, yield DB-level tenant isolation via
Mongo-level role scoping.

**Remediation → app-layer scoping authoritative; dedicated DB for hard isolation** (owner:
per-tenant provisioning child). Falcone's existing application-layer scoping
(`applyTenantScopeToFilter` / `injectTenantIntoDocument` on the `tenantId` field in
`mongodb-data-api.mjs`) must remain the **authoritative** tenant boundary — it is unaffected by
the engine swap and already validated/enforced (a write cannot override `tenantId`; 403
`mongo_data_tenant_scope_violation`). For a hard DB-level boundary, provision a **dedicated
DocumentDB Postgres database (or instance) per tenant tier**, not merely a Mongo "database".

**RLS coexistence (task 7.4) — CLEAN.** On the documentdb-loaded engine, a schema-per-tenant
table with `ENABLE`/`FORCE ROW LEVEL SECURITY`, a non-BYPASSRLS `falcone_app`-style role, and the
`app.tenant_id` GUC policy enforce correctly: the app role saw **1 row** (its tenant) while the
table owner saw 2; the `documentdb_api_catalog` (21 collections) kept functioning. No RLS bypass,
no DDL conflict. DocumentDB ships its own non-privileged roles (`documentdb_admin_role`,
`documentdb_readonly_role`, both non-superuser/non-BYPASSRLS; `documentdb_bg_worker_role`).

**Mapping vs `postgres-applier.mjs` (task 7.3) — DDL gap.** The existing applier manages
`['schemas','tables','views','extensions','grants']` (`CREATE SCHEMA/TABLE/EXTENSION`, `GRANT`),
keyed by `schema = tenantId.replace(/-/g,'_')`, with teardown `DROP SCHEMA … CASCADE`. It has
**no concept of**: (a) per-tenant **login roles with passwords**, (b) **DocumentDB Mongo
databases/collections**, or (c) FerretDB **`createUser`** over the wire. DocumentDB provisioning
therefore needs **either** a new resource type (`roles`) added to this applier **plus** a
companion wire-protocol applier that runs `createUser`/`createCollection` against the gateway,
**or** a dedicated `documentdb-applier`. (Note: the applier already special-cases pgvector
availability via `pg_available_extensions`; on the DocumentDB engine that pre-flight passes —
`vector 0.8.1` is present.)

## 6. Colocated vs dedicated Postgres (task 8) — DECISION: DEDICATED

| Option | Verdict | Rationale |
| --- | --- | --- |
| **Dedicated** Postgres instance running `ghcr.io/ferretdb/postgres-documentdb` solely for the document store + FerretDB gateway | **CHOSEN** | `pg_documentdb_core`/`pg_documentdb` ship **only** in that image and require `shared_preload_libraries` (server-start, not session); keeps the document store's resource isolation and its extra extension surface (`postgis`/`rum`/`pgvector`) off the relational tier |
| **Colocated** — add DocumentDB extensions to the existing in-chart Postgres | **REJECTED** | The default in-chart Postgres is `bitnami/postgresql:17.2.0`, which does **not** bundle `pg_documentdb`; colocation would force **replacing the relational Postgres image** (and its `shared_preload_libraries`) for every tenant's RLS schemas — high blast radius — and load `postgis`/`rum`/`pgvector` onto the relational tier. RLS coexistence is technically clean (proven above), so this is rejected on **image/`shared_preload` coupling and resource isolation**, not on RLS safety |

## 7. Consolidated remediation table (tasks 6.1–6.3)

| Gap | Classification | Remediation | Owner (downstream child) |
| --- | --- | --- | --- |
| Change streams — realtime-executor | UNSUPPORTED (115) | **re-architect** (logical replication slot + `pgoutput`; `REPLICA IDENTITY FULL` for pre-images) | realtime-executor re-architecture |
| Change streams — CDC bridge | UNSUPPORTED (115) | **re-architect** (same; bridge decodes DocumentDB BSON rows) | CDC bridge remediation |
| `changeStreamPreAndPostImages` | UNSUPPORTED (40415) | **re-architect** (covered by `REPLICA IDENTITY FULL`) | realtime-executor child |
| Multi-doc transactions | UNSUPPORTED (59; abort no-op) | **shim** to single-op; reject true multi-doc via `resolveMongoDataCapabilityCompatibility` | data-api migration child |
| Per-database role isolation | UNSUPPORTED as boundary (cross-tenant read succeeds) | **app-layer scoping authoritative** + dedicated DB/instance per tenant for hard isolation | per-tenant provisioning child |
| `$out` / `$merge` / `$geoNear` | engine SUPPORTED; adapter blocks | **use** (no change — adapter allowlist continues to block) | — |
| Text / geo indexes | engine SUPPORTED (bonus) | **use** (not exposed today; no blocker) | — |

## 8. Reproducibility

Attached under `evidence/`: `compose.yaml` (engine-first startup), `probe-main.mjs`,
`probe-refine.mjs`, `probe-ttl.mjs`, `probe-tenancy.mjs`, and the raw `result-*.json` captures
that back every classification above.
