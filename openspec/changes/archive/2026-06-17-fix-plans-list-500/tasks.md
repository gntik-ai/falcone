# Tasks — fix-plans-list-500

## Investigation
- [x] `GET /v1/plans` → `plan-list.mjs` → `plan-repository.list` runs `SELECT * FROM plans`.
- [x] Root cause: the hand-built control-plane runtime (`ensureSchema`) never creates the
  provisioning-orchestrator product schema, so `plans` is absent → 42P01 → 500 (NOT an authz/query
  bug). Verified against the real tests/env Postgres (pre-fix plan-list → 500/42P01).

## Implementation
- [x] `deploy/kind/control-plane/tenant-store.mjs`: `ensureSchema` now creates the canonical plan
  catalog schema (migration 097 — plans + tenant_plan_assignments + plan_audit_events + the shared
  set_updated_at / enforce_plan_status_forward_transition functions and triggers). Idempotent.
- [x] Fix is idempotent (IF NOT EXISTS / OR REPLACE / DROP TRIGGER IF EXISTS) — safe on existing
  deployments; D5's boot retry runs it with backoff.

## Verification
- [x] Real tests/env Postgres: plan-list 500/42P01 before; 200 catalog envelope after; create+list
  round-trips; non-superadmin → 403; ensureSchema re-runs cleanly.
- [x] Black-box test `tests/blackbox/plans-list-schema.test.mjs` (bbx-f3-01/02/03).
- [x] Run `bash tests/blackbox/run.sh`.
- [x] `openspec validate fix-plans-list-500 --strict`.

## Archive
- [x] `/opsx:archive fix-plans-list-500`
