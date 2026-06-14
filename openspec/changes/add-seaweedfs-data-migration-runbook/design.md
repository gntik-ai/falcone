## Context

Falcone's bundled storage engine is MinIO (`charts/in-falcone/values.yaml:2043-2137`,
`storage.enabled: true`, `providerType: minio`). The migration target is SeaweedFS,
which will run side-by-side during the migration window via a chart toggle introduced
by `add-seaweedfs-deployment`. The live kind runtime has no object-upload route wired
(`deploy/kind/control-plane/routes.mjs:118-123`), so the object population on MinIO
is operator-controlled; the migration tooling must handle the general case correctly.

musematic-deploy uses external Hetzner S3 with MinIO disabled and is explicitly out
of scope.

## Goals / Non-Goals

**Goals:**

- A single migration script that performs both the initial bulk sync and the final
  delta sync using the same invocation interface (mode flag distinguishes them).
- Integrity capture (pre/post snapshots) in a machine-readable format consumable by
  the downstream `migration-validation` change.
- A scripted pre-cutover compatibility gate re-using the adr-spike matrix.
- A committed, ordered cutover runbook with explicit gates, rollback instructions per
  step, and a maintenance-window default plus zero-downtime trade-off note.
- A non-prod dry-run requirement with a committed results artifact.

**Non-Goals:**

- Bucket/lifecycle recreation on SeaweedFS (owned by
  `add-seaweedfs-bucket-lifecycle-migration`).
- Credential recreation (separate change).
- Automated production cutover — the runbook is operator-driven.
- Application source or chart source modifications (ops tooling only).
- musematic-deploy or external-S3 clusters.

## Decisions

### D1: rclone sync as the primary tool, mc mirror as fallback

`rclone sync` is chosen as the primary copy mechanism because it supports S3-to-S3
server-side copy (avoiding double-bandwidth), is ETag-aware for idempotency, and
handles multipart objects transparently. `mc mirror --overwrite` is the fallback for
environments where rclone is unavailable, at the cost of client-side data transfer.
A third fallback, `aws s3 sync` (client-side 2-hop via a local staging dir, since the
AWS CLI cannot copy across two distinct endpoints in one command), is used where
neither rclone nor mc is present (e.g. CI runners that ship only the AWS CLI) — at the
cost of double client-side I/O and size/mtime-based change detection; object parity is
still verified independently by `compare-snapshots.sh` (ETags), not by the transfer
tool's own diff. The script detects which tool is present and logs which path was taken.

Alternative considered: custom Go/Python script using AWS SDK — rejected because it
duplicates ETag-delta logic already battle-tested in rclone/mc.

### D2: Maintenance-window mode as the default cutover path

A write-freeze (maintenance window) is the default because:
- The live routes.mjs has no object-upload wired, so the blast radius of a brief
  freeze is negligible in practice.
- A dual-write bridge requires changes to the Falcone application layer, which is
  explicitly out of scope for this ops change.

The runbook surfaces the dual-write/read-through alternative as a documented trade-off
note that the operator must explicitly acknowledge before the write-freeze step,
leaving the door open for a future `add-storage-dual-write-bridge` change.

### D3: Pre/post snapshots as JSON files with `{bucket, objectCount, objects: [{key, etag, size}]}`

JSON is chosen because it is diff-friendly (jq), sortable deterministically, and
directly consumable by the migration-validation change without format negotiation.
The snapshot is written to a configurable output directory (default:
`./migration-snapshots/`) with filenames `pre-<timestamp>.json` and
`post-<timestamp>.json`.

### D4: Compatibility gate re-uses adr-spike matrix assertions

Rather than defining a new compatibility test surface, the gate script is a thin
runner over the adr-spike matrix assertions, parameterized by SeaweedFS endpoint and
credentials. This ensures the go/no-go decision is consistent with the architectural
decision record and avoids drift between what was evaluated and what is gated.

### D5: Runbook as a committed Markdown checklist with inline gate criteria

The runbook is a Markdown file (not a shell script) so it is operator-readable,
auditable via git blame, and executable step-by-step with pauses for human judgment.
Each step has:
- An action block (copy-pasteable shell commands).
- A gate criterion (observable condition to verify before advancing).
- A rollback instruction (what to do if the gate fails).

## Risks / Trade-offs

[Risk: rclone ETag mismatch on server-side-encrypted objects] → Mitigation: disable
SSE on MinIO buckets before migration or use rclone `--s3-no-check-bucket` +
`--checksum` flags; document in runbook.

[Risk: Large object counts make final delta slow under write-freeze] → Mitigation:
initial sync runs before the freeze to minimize delta size; freeze window is bounded
by the delta-only object count, not total object count.

[Risk: SeaweedFS presigned URL TTL behavior differs from MinIO] → Mitigation:
compatibility gate explicitly tests presigned URL round-trip before cutover is
allowed to proceed.

[Risk: Non-prod environment not representative of prod bucket sizes] → Mitigation:
the non-prod dry-run requirement captures timing data; the results artifact includes
object counts so operators can extrapolate freeze-window duration.

## Migration Plan

1. `add-seaweedfs-deployment` is merged and SeaweedFS is running alongside MinIO.
2. `add-seaweedfs-bucket-lifecycle-migration` has created the target buckets.
3. Run compatibility gate against SeaweedFS (adr-spike matrix).
4. Execute initial sync (migration script, bulk mode) — MinIO stays live.
5. Execute non-prod dry-run of full runbook; commit results artifact.
6. At production cutover: execute runbook steps 1–6.
7. If validation fails at step 5 of the runbook: roll back Helm toggle, MinIO
   resumes serving traffic, root-cause the divergence.

## Open Questions

- OQ1: Should the snapshot format include ContentType per object, or is
  `{key, etag, size}` sufficient for the validation change? (Defer to
  `migration-validation` author — the format is extensible.)
- OQ2: What is the acceptable maintenance-window duration SLA for production?
  (Operator decision; dry-run results artifact provides the empirical baseline.)
