## 1. Compatibility Gate Script

- [x] 1.1 Create `tools/migration/compat-gate.sh` that accepts SeaweedFS endpoint,
  access key, and secret key as arguments and runs each assertion from the adr-spike
  compatibility matrix (addressing style, presigned URL round-trip, multipart upload
  completion, IAM/policy evaluation).
- [x] 1.2 Ensure each assertion prints `PASS: <name>` or `FAIL: <name> observed=<x>
  expected=<y>` and that the script exits non-zero if any assertion fails.
- [x] 1.3 Add a top-level `run-compat-gate` Make/shell target that invokes
  `compat-gate.sh` with environment-variable-supplied credentials and prints a
  go/no-go summary line.

## 2. Migration Script

- [x] 2.1 Create `tools/migration/migrate.sh` that accepts `--mode initial|delta`,
  `--source-endpoint`, `--dest-endpoint`, `--buckets` (comma-separated or `all`),
  and credential environment variables.
- [x] 2.2 Implement tool detection: prefer `rclone`; fall back to `mc mirror` if
  rclone is absent; log which tool is active. (Added an `aws s3 sync` 2-hop fallback
  for runners with only the AWS CLI — see design D1; dry-run used this path.)
- [x] 2.3 Implement per-bucket `rclone sync` (or `mc mirror --overwrite`) loop,
  skipping buckets not in the `--buckets` list.
- [x] 2.4 Ensure the script is idempotent: a second run with identical source and
  destination produces no re-uploads and exits zero (verify via `rclone check` or
  `mc diff`).

## 3. Integrity Snapshot Capture

- [x] 3.1 Create `tools/migration/snapshot.sh` that accepts `--endpoint`, `--buckets`,
  `--output-file` and writes a JSON file with schema
  `[{bucket, objectCount, objects: [{key, etag, size}]}]`, objects sorted by key.
- [x] 3.2 Integrate pre-snapshot call into `migrate.sh` before any transfer begins
  (writes `./migration-snapshots/pre-<timestamp>.json`).
- [x] 3.3 Integrate post-snapshot call into `migrate.sh` after final delta completes
  (writes `./migration-snapshots/post-<timestamp>.json`).
- [x] 3.4 Create `tools/migration/compare-snapshots.sh` that accepts two snapshot
  files, diffs object counts and ETags per bucket, prints divergence details, and
  exits non-zero on any mismatch.

## 4. Cutover Runbook Document

- [x] 4.1 Create `tools/migration/RUNBOOK.md` with an ordered checklist of the six
  cutover steps (compatibility gate → write-freeze decision → final delta →
  Helm toggle re-point → validate → switch traffic), each step containing: action
  block with copy-pasteable shell commands, gate criterion, and rollback instruction.
- [x] 4.2 Add the write-freeze decision section that presents both the
  maintenance-window path (default) and the dual-write/read-through bridge
  alternative, requiring the operator to make an explicit selection before continuing.
- [x] 4.3 Document the Helm upgrade command that re-points Falcone to SeaweedFS
  by setting `storage.config.inline.provider`, `storage.config.inline.providerType`,
  and `storage.config.inline.providerSelectionMode` values.
- [x] 4.4 Add a rollback section at the end of the runbook covering the Helm toggle
  revert (MinIO back) and traffic re-point, with the command to verify MinIO is
  serving again.

## 5. Non-Prod Dry-Run and Results Artifact

- [x] 5.1 Execute the full cutover runbook against a non-production MinIO+SeaweedFS
  environment (can be a local Docker Compose stack or the kind test cluster).
- [x] 5.2 Collect the compatibility gate output, pre-sync snapshot, post-sync
  snapshot, snapshot-diff output, and per-step outcomes.
- [x] 5.3 Commit the collected output as `tools/migration/runbook-results/
  <env>-<timestamp>.md` containing: environment identifier, execution timestamp,
  pre-sync snapshot digest (sha256 of the JSON file), post-sync snapshot digest,
  compatibility gate pass/fail per assertion, and outcome of each runbook step.
  → `tools/migration/runbook-results/docker-local-20260614T111139Z.md` (pre/post
  snapshot digests byte-identical = exact object parity).

## 6. Validation

- [x] 6.1 Run `compare-snapshots.sh` on the non-prod pre/post snapshots and confirm
  exit zero (counts and ETags match) — record in results artifact.
- [x] 6.2 Run `compat-gate.sh` a second time after the non-prod Helm toggle re-point
  to verify SeaweedFS is serving correctly — record result.
- [x] 6.3 Verify `migrate.sh` is idempotent on the non-prod environment: run it twice
  in delta mode and confirm no re-uploads occurred.
