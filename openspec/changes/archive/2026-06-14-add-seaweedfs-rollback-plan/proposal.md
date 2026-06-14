## Why

Cutting over from MinIO to SeaweedFS carries operational risk: if SeaweedFS exhibits
problems after cutover, there is currently no tested procedure to re-point Falcone back
to the prior store. A time-bounded, tested rollback capability is required before the
cutover can be treated as production-safe.

## What Changes

- After cutover, the MinIO StatefulSet is retained in a read-only state (no new writes
  accepted) for a defined window (N days) by keeping the side-by-side chart toggle
  active and not reclaiming its PVC.
- A rollback procedure is documented as an ordered checklist: freeze writes, re-point
  Falcone's storage backend config back to MinIO (chart toggle / endpoint env), validate
  with the per-tenant storage smoke test, then resume traffic.
- Trigger conditions and the point-of-no-return (when the MinIO PVC is reclaimed /
  MinIO StatefulSet is deleted) are defined and recorded in the runbook.
- Writes that land on SeaweedFS during the rollback window are explicitly scoped: the
  rollback window is treated as read-only on the old store; a delta-back sync note is
  included for operators who need those writes preserved.
- A non-prod rollback test gate is required before the decommission step: re-point to
  MinIO, run per-tenant smoke, confirm green before proceeding to PVC deletion.
- The decommission step (delete MinIO StatefulSet + PVC) is an explicit, gated final
  step recorded in the runbook.

## Capabilities

### New Capabilities

### Modified Capabilities

- `storage`: ADDED requirements for a tested, time-bounded rollback procedure from
  SeaweedFS back to MinIO, including PVC retention, rollback trigger conditions, a
  defined point-of-no-return, and a mandatory non-prod validation gate.

## Impact

- `charts/in-falcone/values.yaml` (lines 2043-2137): MinIO StatefulSet + PVC must not
  be torn down at cutover; chart side-by-side toggle drives retention.
- Deployment change (`add-seaweedfs-deployment`): provides the side-by-side toggle this
  change depends on.
- Migration runbook (`add-seaweedfs-data-migration-runbook`): cutover runbook that
  precedes this rollback window.
- Migration validation (`add-seaweedfs-migration-validation`): per-tenant smoke used as
  the rollback validation gate.
- No application source code changes; this is infrastructure/ops-only (P2).
