## 1. Reproduce / encode the gap

- [x] 1.1 Confirm issue #802 root cause: the console plan detail page rendered tabs and
  limits only, while `transitionPlanLifecycle` existed in the frontend API client but was
  unused and no bare plan delete action/route existed.
- [x] 1.2 Add frontend tests for the acceptance scenarios:
  - draft plan detail offers activation and reflects the active status after transition;
  - plan deletion is available only through an explicit confirmation flow.
- [x] 1.3 Add backend tests for safe plan deletion and refusal of assigned/historical plans.

## 2. Backend / wire

- [x] 2.1 Add a superadmin-only `plan-delete` action.
- [x] 2.2 Refuse deletion for plans with active or historical tenant assignments.
- [x] 2.3 Preserve audit/history integrity and emit a `plan.deleted` event.
- [x] 2.4 Wire `DELETE /v1/plans/{planId}` through gateway, kind runtime route maps, and
  the test action-runner route table.

## 3. Frontend

- [x] 3.1 Type lifecycle transition and delete responses in `planManagementApi`.
- [x] 3.2 Add lifecycle controls to `/console/plans/{planId}` and refresh the displayed
  status after a successful transition.
- [x] 3.3 Add destructive confirmation for deprecate, archive, and delete.
- [x] 3.4 Navigate back to the plan catalog after successful deletion.

## 4. Spec / docs / verification

- [x] 4.1 Materialize the OpenSpec delta for `web-console` and `quotas-plans`.
- [x] 4.2 Add human documentation for lifecycle/removal behavior.
- [x] 4.3 Run focused backend and frontend tests.
- [x] 4.4 Run `openspec validate fix-802-plan-lifecycle-console --strict`.
- [x] 4.5 Run `git diff --check`.
- [x] 4.6 Commit the final fix on `fix/802-plan-lifecycle-console`.
