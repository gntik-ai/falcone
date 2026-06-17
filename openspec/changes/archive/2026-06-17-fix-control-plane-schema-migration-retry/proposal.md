# fix-control-plane-schema-migration-retry

## Change type
bug-fix

## Capability
tenant-lifecycle (cap-tenant-lifecycle)

## Priority
P1

## Why (Problem Statement)
The control-plane runs DB schema migrations exactly once on startup and never retries
on `ECONNREFUSED`. If PostgreSQL is not yet ready when the control-plane starts (a
common Kubernetes timing scenario), the `tenants` table is never created and every
subsequent tenant operation returns 500.

**Evidence (live campaign 2026-06-17):**
- Log: `schema/recovery failed: connect ECONNREFUSED …:5432`
- Log: `relation "tenants" does not exist`
- Workaround: pod restart after Postgres is ready.

## What Changes
Add retry-with-exponential-backoff to the boot migration path. The control-plane
MUST keep retrying until either the DB is reachable and migrations succeed, or a
configurable max-retry timeout expires (default: retry for 5 minutes, cap to ~30 s
between attempts).

## Impact
- **Operational:** eliminates a class of pod-restart-to-recover failures in fresh
  installs and rolling restarts.
- **Breaking change:** none.
- **Dependencies:** none.
