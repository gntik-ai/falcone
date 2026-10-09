# Audit chain integrity and rollback (#978)

Every new `plan_audit_events` row uses the shared hashed append in
`apps/control-plane/audit-store.mjs`. Each tenant has its own chain; NULL
`tenant_id` identifies the platform-global chain. Appends serialize with a
per-scope transaction advisory lock, choose the latest non-NULL `row_hash`, and
use a timestamp strictly after that head so `(created_at, id)` preserves append
order. Plan references and previous states remain stored but are outside the
unchanged canonical field set.

Callers inside a transaction must use `recordAuditEventInTransaction`; otherwise
`recordAuditEvent` owns BEGIN/COMMIT. The orchestrator adapter preserves its
existing in-memory persistence seam with the same hashing implementation.

`verifyAuditChain(rows)` requires oldest-first rows and genesis (`prev_hash = ''`)
at index zero. For a contiguous window, supply `{ expectedAnchor: predecessorHash }`
as the second argument, using a trusted predecessor. A missing hash anywhere,
content mismatch, anchor mismatch, or broken link returns `valid: false` and the
first broken index in the supplied array. Legacy prefixes are never skipped.

Historical NULL rows and historical reset rows are left untouched. Complete
historical chains containing these defects continue to report invalid at the
first defect. A prefix deleted exactly up to a historical genesis reset may
still verify. Removing a terminal suffix (including the entire log) cannot be
detected from retained rows alone; detecting that needs a trusted head or row
count. Removing a run with a retained successor, including a run just before
the final row, is detected. External checkpointing and historical epoch markers
are outside this change.

## Schema guard and image rollback

Startup adds the deterministic constraint `plan_audit_events_hashes_required`
idempotently with `CHECK (prev_hash IS NOT NULL AND row_hash IS NOT NULL) NOT VALID`.
This enforces the check for new inserts and updates without scanning or rewriting
legacy rows. An installation failure propagates through the existing fail-closed
startup gate. Legacy rows themselves do not prevent startup.

Before or together with rolling back either image to a version with unhashed
orchestrator writers, the operator must remove the guard:

```sql
ALTER TABLE plan_audit_events
  DROP CONSTRAINT IF EXISTS plan_audit_events_hashes_required;
```

Coordinate this with the image rollback: restarting the fixed control-plane
image installs the guard again. Keeping the guard while running old writers
makes their audit INSERTs fail and plan/sub-quota operations error. Dropping it
allows those old writers to emit unhashed records again. Reapplying the fixed
image reinstalls the guard without repairing any intervening historical rows.
Deployment and rollback execution remain operator-owned.
