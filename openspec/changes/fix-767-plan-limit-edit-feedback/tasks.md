## 1. Reproduce / encode the bug

- [x] 1.1 Confirm the root cause from issue #767: `ConsolePlanDetailPage.tsx` fire-and-forgets
  `api.setPlanLimit` / `api.removePlanLimit` and optimistically mutates `profile`, while
  `PlanLimitsTable` uses uncontrolled `defaultValue` inputs.
- [x] 1.2 Add focused web-console tests for the acceptance scenarios:
  - rejected edit shows an explicit error and restores the persisted value;
  - successful edit displays the API-accepted/reconciled value;
  - reset displays the real reverted/default value without reload;
  - refreshed table props reset a locally typed draft.

## 2. Fix

- [x] 2.1 Await `setPlanLimit` and `removePlanLimit` in the plan detail page.
- [x] 2.2 Show success/error feedback on the Limits tab.
- [x] 2.3 Reconcile successful writes from accepted API data and then from
  `getPlanLimitsProfile`, preferring the refreshed profile.
- [x] 2.4 Restore/refetch the persisted profile after rejected writes so failed values are not
  displayed as saved.
- [x] 2.5 Make `PlanLimitsTable` inputs controlled from refreshed profile props while still
  allowing local typing before blur.

## 3. Wire / contract / docs

- [x] 3.1 Type existing plan-limit API responses in `planManagementApi.ts`; do not change the
  public API route, request shape, response shape, or generated artifacts.
- [x] 3.2 Add OpenSpec deltas for `web-console` and `quotas-plans`.
- [x] 3.3 Add docs explaining the console reconciliation rule for plan-limit edits.
- [x] 3.4 Codegen/source-of-truth check: no OpenAPI/route-catalog/SDK source changed, so codegen
  is expected to be no-diff and is not required for this frontend-only fix.

## 4. Verify

- [x] 4.1 Run focused web-console tests for `ConsolePlanDetailPage` and `PlanLimitsTable`.
- [x] 4.2 Run `openspec validate fix-767-plan-limit-edit-feedback --strict`.
- [x] 4.3 Run `git diff --check`.
- [x] 4.4 Attempt `pnpm --dir apps/web-console typecheck`; the command is blocked by
  existing project-wide TypeScript errors outside this change.
- [x] 4.5 Commit the final fix on `fix/767-plan-limit-edit-feedback`.
