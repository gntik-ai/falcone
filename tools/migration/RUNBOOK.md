# MinIO → SeaweedFS Cutover Runbook

Operator-executable, gated cutover from the bundled MinIO (`../falcone-charts/charts/in-falcone/values.yaml`,
`storage.enabled: true`) to SeaweedFS. Run the steps **in order**. Each step has an
**Action**, a **Gate** (observable condition that must hold before advancing), and a
**Rollback** (what to do if the gate fails). **Do not advance past a failed gate.**

Scope: clusters running the bundled MinIO. Out of scope: musematic-deploy / external
S3 (MinIO disabled). Prerequisites: `add-seaweedfs-deployment` merged (SeaweedFS runs
alongside MinIO via the chart toggle) and `add-seaweedfs-bucket-lifecycle-migration`
applied (target buckets exist on SeaweedFS).

Environment variables used throughout:

```sh
export SRC_ENDPOINT="http://falcone-storage:9000"          # MinIO (source)
export DEST_ENDPOINT="http://falcone-seaweedfs-s3:8333"    # SeaweedFS (dest)
export SRC_ACCESS_KEY=...   SRC_SECRET_KEY=...             # MinIO admin creds
export DEST_ACCESS_KEY=...  DEST_SECRET_KEY=...            # SeaweedFS admin creds
export BUCKETS="all"                                       # or csv: ten-a-ws-1,ten-b-ws-1
cd tools/migration
```

> Run the **initial bulk sync before** starting this runbook, while MinIO is still
> live, to minimise the final-delta size (and therefore the write-freeze window):
> ```sh
> SRC_ACCESS_KEY=$SRC_ACCESS_KEY SRC_SECRET_KEY=$SRC_SECRET_KEY \
> DEST_ACCESS_KEY=$DEST_ACCESS_KEY DEST_SECRET_KEY=$DEST_SECRET_KEY \
>   ./migrate.sh --mode initial --source-endpoint "$SRC_ENDPOINT" \
>                --dest-endpoint "$DEST_ENDPOINT" --buckets "$BUCKETS"
> ```

---

## Step 1 — Pre-cutover compatibility gate (go/no-go)

**Action**

```sh
./compat-gate.sh "$DEST_ENDPOINT" "$DEST_ACCESS_KEY" "$DEST_SECRET_KEY"
```

**Gate** — the script prints `GO:` and exits `0` (every assertion `PASS`: addressing
style, object round-trip, presigned GET, multipart completion, IAM/bucket-policy).

**Rollback** — if any assertion `FAIL`s the script prints `NO-GO` and exits non-zero.
**Stop here.** Do not freeze writes. Root-cause the failing assertion against SeaweedFS
(re-check the adr-spike compatibility matrix); cutover is not safe until it passes.

---

## Step 2 — Write-freeze decision (explicit operator selection required)

Choose **one** path and record the choice before continuing. The remaining steps assume
the maintenance-window path unless you have implemented the dual-write bridge.

### Option A — Maintenance window / write-freeze (DEFAULT, simpler)

Brief, bounded downtime: writes to object storage are frozen for the duration of the
final delta + validation. The live `apps/control-plane/routes.mjs` has no
object-upload route wired, so in practice the blast radius is small.

**Action**

```sh
# Begin the maintenance window: stop/scale down any writers to object storage,
# announce the window, and confirm no new objects are being written to MinIO.
```

**Gate** — object count on MinIO is stable across two reads 30s apart (no new writes).

### Option B — Zero-downtime dual-write / read-through bridge (ALTERNATIVE, complex)

No downtime, but requires an application-layer dual-write bridge (writes go to BOTH
MinIO and SeaweedFS, reads fall through MinIO→SeaweedFS) that does **not exist today**
and is **out of scope** for this ops change. It would be delivered by a future
`add-storage-dual-write-bridge` change. Only select this if that bridge is deployed and
verified. **Trade-off:** higher operational complexity and a window where the two stores
can diverge if the bridge fails.

> **Operator: record your selection (A or B) and rationale in the runbook-results
> artifact before proceeding.** Do not continue until this is acknowledged.

---

## Step 3 — Final delta sync

**Action**

```sh
SRC_ACCESS_KEY=$SRC_ACCESS_KEY SRC_SECRET_KEY=$SRC_SECRET_KEY \
DEST_ACCESS_KEY=$DEST_ACCESS_KEY DEST_SECRET_KEY=$DEST_SECRET_KEY \
  ./migrate.sh --mode delta --source-endpoint "$SRC_ENDPOINT" \
               --dest-endpoint "$DEST_ENDPOINT" --buckets "$BUCKETS"
```

**Gate** — `migrate.sh` exits `0` and writes a `post-<timestamp>.json` snapshot under
`./migration-snapshots/`. Note the `pre-*.json` (from the initial run) and this
`post-*.json` for Step 5.

**Rollback** — if the sync errors, do **not** re-point. Re-run the delta (it is
idempotent); if it still fails, lift the write-freeze (MinIO resumes serving) and
root-cause.

---

## Step 4 — Re-point Falcone to SeaweedFS (Helm toggle)

**Action** — set the inline storage provider fields and upgrade. (Endpoint/credentials
for SeaweedFS are supplied by `add-seaweedfs-deployment`; only the provider selection
changes here.)

```sh
helm upgrade falcone ../falcone-charts/charts/in-falcone --reuse-values \
  --set storage.config.inline.provider=s3-compatible \
  --set storage.config.inline.providerType=seaweedfs \
  --set storage.config.inline.providerSelectionMode=explicit \
  --skip-schema-validation
kubectl -n <ns> rollout status deploy/falcone-control-plane
```

**Gate** — the control-plane rollout completes and reports `providerType: seaweedfs`
in the rendered storage config; re-run the compatibility gate against the **live**
re-pointed service:

```sh
./compat-gate.sh "$DEST_ENDPOINT" "$DEST_ACCESS_KEY" "$DEST_SECRET_KEY"   # expect GO
```

**Rollback** — see the **Rollback** section below (revert the Helm toggle to MinIO).

---

## Step 5 — Validate object parity

**Action**

```sh
./compare-snapshots.sh ./migration-snapshots/pre-<ts>.json ./migration-snapshots/post-<ts>.json
```

**Gate** — prints `PASS` and exits `0` (object counts **and** ETags identical for every
bucket between the pre-cutover MinIO snapshot and the post-delta SeaweedFS snapshot).

**Rollback** — if it prints `FAIL` with divergences, **do not switch traffic**. Revert
the Helm toggle (Rollback section), MinIO resumes serving, and reconcile the divergent
objects (re-run the delta sync for the affected buckets).

---

## Step 6 — Switch traffic

**Action**

```sh
# Cut external traffic / ingress to the SeaweedFS-backed service and end the
# maintenance window (resume writers).
```

**Gate** — application storage operations succeed against SeaweedFS (smoke: list a
bucket, read a known object) and MinIO can be scaled down. Record a completion
timestamp in the runbook-results artifact.

**Rollback** — if post-switch smoke fails, follow the Rollback section.

---

## Rollback (any step)

Re-point Falcone back to MinIO and resume serving from it. Because the initial+delta
sync is one-directional (MinIO→SeaweedFS) and MinIO was only frozen (not deleted),
MinIO remains the source of truth until traffic is switched.

```sh
helm upgrade falcone ../falcone-charts/charts/in-falcone --reuse-values \
  --set storage.config.inline.provider=s3-compatible \
  --set storage.config.inline.providerType=minio \
  --set storage.config.inline.providerSelectionMode=explicit \
  --skip-schema-validation
kubectl -n <ns> rollout status deploy/falcone-control-plane

# Verify MinIO is serving again:
./compat-gate.sh "$SRC_ENDPOINT" "$SRC_ACCESS_KEY" "$SRC_SECRET_KEY"   # expect GO
```

Lift the write-freeze. SeaweedFS identities/objects written during the window are
harmless (the application stops using them); clean them up out-of-band if desired.

---

## Non-prod dry-run requirement

Before any production cutover, execute this full runbook against a non-production
MinIO+SeaweedFS environment (local Docker Compose or the kind test cluster) and commit
the results under `tools/migration/runbook-results/<env>-<timestamp>.md` (see the
existing results for the expected shape: snapshot digests, per-assertion gate results,
and per-step outcomes).
