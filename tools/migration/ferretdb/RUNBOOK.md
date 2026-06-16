# MongoDB → FerretDB Data Migration & Cutover Runbook

> [!CAUTION]
> **Realtime and CDC features are NON-FUNCTIONAL on FerretDB.** MongoDB change streams are
> unsupported (`watch()` returns `CommandNotSupported(115)`; `changeStreamPreAndPostImages` returns
> `UnknownBsonField(40415)`). The realtime SSE executor (`realtime-executor`) and the Kafka CDC bridge
> (`mongo-cdc-bridge`) will NOT work against FerretDB on MongoDB change streams. **Do NOT re-enable
> these features after cutover until `add-ferretdb-realtime-cdc-remediation` (#460) is applied** (it
> re-architects them onto Postgres logical replication).

## Migration model: maintenance-window write-freeze ONLY

There is **no zero-downtime / dual-write alternative**. A dual-write or CDC-tailed sync would require
MongoDB change streams (unsupported on FerretDB) and/or atomic multi-document transactions (also
unsupported: `commitTransaction` returns `CommandNotFound(59)`, in-transaction writes are non-atomic,
`abortTransaction` is a silent no-op). The only safe, convergent cutover is:

1. **Initial bulk copy** (online, no freeze) — snapshot the source and idempotently upsert it.
2. **Write-freeze** — stop writes to the source (maintenance window).
3. **Delta convergence** — re-export documents changed since the initial copy and idempotently upsert.
4. **Verify, re-point, resume.**

All applies are per-document `replaceOne({_id}, doc, {upsert:true})` — idempotent and re-runnable after
a partial failure. `mongodump --oplog` / `mongorestore --oplogReplay` and `mongorestore --drop` are
**never** used (oplog replay needs atomic multi-doc apply; `--drop` is destructive and non-idempotent).

Pinned target version pair: `ferretdb:2.7.0` / `postgres-documentdb:17-0.107.0-ferretdb-2.7.0`.

---

## Pre-cutover (online, no write-freeze)

Run the initial bulk copy while the source is live. It is safe to run repeatedly; re-runs only
re-apply the latest snapshot idempotently.

```bash
tools/migration/ferretdb/migrate.sh --mode initial \
  --source-uri "$SOURCE_MONGO_URI" \
  --dest-uri   "$FERRETDB_URI" \
  --dbs all \
  --output-dir ./migration-dump --snapshot-dir ./migration-snapshots
```

This writes a pre-copy source snapshot (`./migration-snapshots/pre-<ts>.json`) and a post-copy target
snapshot (`./migration-snapshots/post-<ts>.json`). Record `<ts>` — the cutover delta uses a timestamp
at/after the initial copy.

---

## Cutover (gated steps)

### Step 1 — Preconditions (GATE)

```bash
tools/migration/ferretdb/preflight.sh \
  --ferretdb-uri "$FERRETDB_URI" \
  --engine-pod   "$DOCUMENTDB_ENGINE_POD" --namespace "$NS"   # omit --engine-pod for Docker Compose
```

**Gate:** exits `PREFLIGHT PASS` only when the dedicated `postgres-documentdb` engine is Ready
(engine-first ordering) AND the FerretDB gateway is reachable with the confirmed version pair.
**Rollback:** none required — no data has moved.

### Step 2 — Write-freeze / maintenance-window start

Stop all writes to the source MongoDB (scale writers to zero / enable maintenance mode). Record the
freeze time `T0` (UTC ISO-8601). **Gate:** confirm no further writes reach the source.
**Rollback:** lift the freeze; no data has moved.

### Step 3 — Delta re-export + idempotent upsert (inside the freeze)

```bash
tools/migration/ferretdb/migrate.sh --mode delta \
  --source-uri "$SOURCE_MONGO_URI" --dest-uri "$FERRETDB_URI" --dbs all \
  --since-timestamp "$INITIAL_COPY_TS" --update-field updatedAt \
  --output-dir ./migration-dump --snapshot-dir ./migration-snapshots
```

Re-exports documents changed since the initial copy (query-filtered for collections with an
update-time field; full re-export otherwise — idempotent either way) and upserts them. Index
definitions are re-applied (idempotent). Writes a post-delta target snapshot.
**Rollback:** Step 7 (re-point) has not happened; the source is still authoritative — lift the freeze.

### Step 4 — Index recreation (included in Step 3)

`migrate.sh` runs `export-indexes.sh` + `recreate-indexes.sh`. All index types migrate
(single/compound/unique/sparse/TTL/text/2dsphere); `text`/`2dsphere` version metadata from the source
is stripped so FerretDB 2.7.0 applies its supported version. Confirm `recreate-indexes` reports
`PASS` for every index and exits zero.

### Step 5 — Integrity verification (GATE)

```bash
tools/migration/ferretdb/compare-snapshots.sh \
  --source ./migration-snapshots/pre-<initial-ts>.json \
  --target ./migration-snapshots/post-<delta-ts>.json
```

**Gate:** must exit zero — per-collection document counts and (engine-agnostic) sha256 checksums match
between source and target. Investigate any `MISMATCH` before proceeding. **Rollback:** do NOT re-point;
lift the freeze; the source remains authoritative.

### Step 6 — Re-point Falcone to FerretDB

Falcone resolves its document store from `MONGO_URI`
(`apps/control-plane/src/runtime/main.mjs::mongoUri`). Update it to the FerretDB gateway endpoint:

```diff
- MONGO_URI=mongodb://<user>:<pass>@<mongodb-host>:27017/?replicaSet=rs0
+ MONGO_URI=mongodb://<user>:<pass>@<ferretdb-gateway-host>:27017/
+ MONGO_BACKEND=ferretdb        # rejects unsupported transaction ops at the boundary
```

Apply via Helm upgrade / pod restart, honouring **engine-first startup order** — the
`postgres-documentdb` engine must be Ready before the `ferretdb` gateway starts:

```bash
helm upgrade <release> charts/in-falcone -f <values> --set ... --wait
# or, for a pre-deployed stack:
kubectl rollout restart deploy/<release>-control-plane -n "$NS"
```

**Gate:** control-plane pods Ready; a smoke read/write against the FerretDB-backed data API succeeds.

### Step 7 — Exit maintenance window

Lift the write-freeze and resume traffic against the FerretDB-backed stack.

---

## Rollback

If any gate fails **before Step 6**, simply lift the write-freeze — no data has moved and the source
MongoDB remains authoritative. If a rollback is required **after Step 6**:

1. Revert `MONGO_URI` (and unset `MONGO_BACKEND`) to the original MongoDB endpoint.
2. Re-apply via Helm upgrade / pod restart.
3. Resume against MongoDB.

See **`ROLLBACK-RUNBOOK.md`** (`add-ferretdb-rollback-plan`, #463) for the full rollback procedure,
including the read-only fallback window, the two-plane model (data-API re-point vs realtime/CDC
pre-#460 image redeploy), the best-effort delta-back sync, and the non-prod validation gate.
Validation thresholds and per-tenant smoke checks are owned by `add-ferretdb-migration-validation`
(#462).
