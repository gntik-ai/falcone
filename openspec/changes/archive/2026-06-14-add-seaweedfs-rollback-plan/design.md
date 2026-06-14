## Context

Falcone's storage backend is migrating from MinIO (a StatefulSet with a PVC, defined in
`charts/in-falcone/values.yaml:2043-2137`) to SeaweedFS. The deployment change
(`add-seaweedfs-deployment`) introduces a chart side-by-side toggle that keeps MinIO
running alongside SeaweedFS after cutover. Without a tested, time-bounded rollback plan
the cutover carries unacceptable risk: operators have no safe path back if SeaweedFS
exhibits problems in the post-cutover window.

This change is infrastructure/ops-only. No application source changes are required;
the storage backend is selected entirely through chart values (the endpoint env var and
the side-by-side toggle). The existing per-tenant storage smoke test
(`add-seaweedfs-migration-validation`) serves as the validation gate for both cutover
and rollback.

## Goals / Non-Goals

**Goals:**

- Define the rollback window length (N days, default 7) and record it in the runbook.
- Specify that the MinIO StatefulSet and PVC are NOT reclaimed until the window closes
  and a non-prod rollback test passes.
- Document an ordered rollback procedure (freeze writes, re-point config, validate,
  resume) and the trigger conditions that activate it.
- Define the point-of-no-return: once the MinIO PVC is reclaimed, rollback is no longer
  possible without a restore from backup.
- Record the delta-back sync note for writes that landed on SeaweedFS during the window.
- Gate the decommission step (PVC + StatefulSet deletion) on the non-prod rollback test
  being green.

**Non-Goals:**

- Permanent dual-run / multi-backend operation beyond the rollback window.
- Automated failover or health-based traffic switching between MinIO and SeaweedFS.
- Data migration in the reverse direction as part of this change (covered by the data
  migration runbook; only acknowledged as a delta-back sync note here).

## Decisions

### D1 — Retain MinIO via the existing side-by-side toggle, not a separate gate

The `add-seaweedfs-deployment` chart toggle already keeps MinIO running post-cutover.
Reusing it avoids adding a new Helm flag. The rollback procedure simply flips the
active backend endpoint back to MinIO and disables SeaweedFS routing — no additional
infrastructure required.

Alternative considered: add a Helm `storage.rollbackEnabled` flag that explicitly
controls MinIO retention independent of the side-by-side toggle. Rejected because it
duplicates existing toggle semantics and adds chart surface area with no operational
benefit in the rollback window.

### D2 — Treat the rollback window as read-only on the old store

Writes that land on SeaweedFS during the window are NOT automatically synced back if
rollback is triggered. The window is intentionally short (default 7 days) to bound the
delta. Operators who require those writes preserved must run a manual delta-back sync
(documented as a runbook note) before re-pointing. This is simpler and safer than an
automated bidirectional sync.

### D3 — Non-prod validation gate before decommission

A non-prod (staging) re-point test must be executed and must produce a green per-tenant
smoke result before the decommission step is unblocked. This guards against a scenario
where the rollback procedure itself is broken at the time it is needed in production.

## Risks / Trade-offs

- [Rollback window writes lost] SeaweedFS writes made during the window are not
  available on MinIO after rollback. Mitigation: window is bounded (default 7 days);
  delta-back sync note is included in runbook for operators who need those objects.

- [PVC retention cost] Keeping the MinIO PVC active for N days incurs storage cost.
  Mitigation: window is bounded and cost is explicitly acknowledged; decommission step
  reclaims storage at window close.

- [Non-prod gate may not match prod] The staging rollback test may not fully exercise
  prod data volumes. Mitigation: the gate tests the procedure (re-point + smoke green),
  not data completeness; a separate data-migration runbook covers completeness.

- [Point-of-no-return is operator-controlled] Deletion of the MinIO PVC is a manual
  step; it is not enforced automatically. Mitigation: the runbook makes the
  point-of-no-return explicit with a warning, and the decommission step is gated on the
  non-prod test.

## Migration Plan

This change itself introduces no data migration. The plan is sequenced:

1. `add-seaweedfs-deployment` is applied first (side-by-side toggle available).
2. `add-seaweedfs-data-migration-runbook` cutover is executed (MinIO frozen, traffic
   re-pointed to SeaweedFS).
3. This rollback plan is activated: MinIO StatefulSet kept running (read-only), PVC
   retained, rollback window starts.
4. At window close: non-prod rollback test executed; if green, decommission step
   proceeds (delete MinIO StatefulSet + PVC, disable side-by-side toggle).

## Open Questions

- What is the exact value of N (rollback window length in days) for this deployment?
  Default proposed: 7 days. To be confirmed by the ops team before cutover.
- Is there a monitoring alert that fires if the MinIO StatefulSet becomes unhealthy
  during the retention window (while it is read-only)? If so, wire it to the rollback
  trigger conditions.
