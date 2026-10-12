## Why

Issue #960 reports that POST /v1/tenants returns assigned=true for an active plan, but subsequent
plan and history reads find no assignment. The inline helper passes a Pool to plan-assign, whose
insertWithHistory transaction requires one connection. Pool dispatch can send COMMIT to a different
session from BEGIN and the writes, leaving the assignment uncommitted.

## What Changes

- Check out one client in assignPlanBestEffort when the supplied handle supports connect().
- Resolve slugs and run the existing plan-assign action on that client. Keep transaction ownership
  in insertWithHistory and release the acquired client once in finally on every path.
- Preserve best-effort tenant creation, including connection and release failures. Acquisition
  errors return a generic reason without connection details; borrowed plain clients are not released.
- Add regression coverage at the exported helper and public plan/history actions using real
  repositories and a deterministic database boundary fake. Document committed assignment semantics.

## Capabilities

### Modified Capabilities

- `tenant-lifecycle`: inline plan assignment persists before reporting assigned=true.

## Delivery Boundary and Risk

This R3 source change touches only the inline helper, its tests, architecture reference and this
OpenSpec delta. No deployment-repository, chart, migration, console, dedicated plan route, wire-shape
or saga-compensation change is required. Human approval and dual-provider review remain merge gates.
One pool connection is held only during assignment; pool exhaustion degrades to assigned=false.
Rollback reverts the helper change. Existing missing assignments require operator audit and explicit
reassignment; this change performs no backfill.
