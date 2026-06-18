# Tasks — fix-workspace-quota-enforcement

## Reproduce (test-first)
- [x] Failing black-box test: `tests/blackbox/workspace-quota-enforcement.test.mjs` (bbx-556-01..04). RED before (the `workspace-quota.mjs` helper did not exist; `createWorkspace` had no gate). Exercises the helper against the REAL product governance model over a stub pool: usage<limit allowed, usage==limit denied (hard_blocked), override raises ceiling, fail-open when the model is unavailable.

## Implement (kind runtime AND shippable product)
- [x] Gate workspace creation on the resolved `max_workspaces` entitlement — `deploy/kind/control-plane/b-handlers.mjs::createWorkspace` now counts existing workspaces (`store.countTenantWorkspaces`, added to `tenant-store.mjs`) and calls `checkWorkspaceQuota` (new `deploy/kind/control-plane/workspace-quota.mjs`) BEFORE inserting; a non-allowed decision → `402 QUOTA_EXCEEDED`.
- [x] Reuses the product's single source of truth (no re-derivation): `resolveEffectiveLimit(db, tenant, 'max_workspaces')` (override → plan → seeded default 3) + `evaluateQuotaDecision` (hard/soft/grace/unlimited). Depends on #555 having created+seeded `quota_dimension_catalog`/`quota_overrides`/plan tables. Fails OPEN if the governance model is unavailable (quota is a governance control, not an isolation boundary).
- [x] DUAL-LOCUS determination: the shippable product already enforces quotas through this governance model on its own paths; the **gap was the kind `createWorkspace` glue handler**, which (like the other governance findings) bypassed it. The product model + repositories are reused unchanged; no new product code is required.

## Verify
- [x] `node --test tests/blackbox/workspace-quota-enforcement.test.mjs` → 4/4 green; `node --check` on the new/edited modules OK. (Full suite + CI quality subset in the batch barrier.)
- [ ] Acceptance (live): creating past `max_workspaces` → 402 — folded into the consolidated live RED→GREEN verification on kind (depends on #555 schema).

## Archive
- [ ] `openspec validate fix-workspace-quota-enforcement --strict`; archive in the batch (after the combined commit closing the issue).
