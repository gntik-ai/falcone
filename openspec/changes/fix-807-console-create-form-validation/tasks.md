## 1. Reproduce / encode the contract

- [x] 1.1 Confirm the reported roots: workspace and function wizards convert string limit fields
  with `Number(...)` during submit while the relevant steps do not validate those fields; the plan
  create page validates slug but not blank/whitespace display name.
- [x] 1.2 Add regression tests for `CreateWorkspaceWizard` that drive the configuration step and
  assert `workspace-max-functions` / `workspace-max-databases` reject empty, non-numeric, zero,
  out-of-range, and negative values inline while `Siguiente` is disabled and no request is sent.
- [x] 1.3 Add regression tests for `PublishFunctionWizard` that drive the runtime step and assert
  `fn-memory` / `fn-timeout` reject empty, non-numeric, zero, out-of-range, and negative values
  inline while `Siguiente` is disabled and no request is sent.
- [x] 1.4 Add regression coverage for `ConsolePlanCreatePage` asserting whitespace-only
  `display-name` shows an inline error and does not call `createPlan`.

## 2. Fix

- [x] 2.1 Add a strict required-integer parser for console create forms.
- [x] 2.2 Validate `CreateWorkspaceWizard` configuration limits inline and re-parse them before
  building `initialLimits`.
- [x] 2.3 Validate `PublishFunctionWizard` runtime limits inline and re-parse them before
  building `limits`.
- [x] 2.4 Validate `ConsolePlanCreatePage` display name before calling `createPlan`.

## 3. Wire / contract / docs

- [x] 3.1 Leave OpenAPI, generated clients, shared contract artifacts, backend routes, and
  real-time/event shapes unchanged because this is a frontend-only validation fix.
- [x] 3.2 Add `docs/reference/architecture/console-create-form-validation.md` documenting the
  console create-form validation invariants, numeric bounds, and submit-time re-parse rule.
- [x] 3.3 Add this OpenSpec change under
  `openspec/changes/fix-807-console-create-form-validation/`.

## 4. Verify

- [x] 4.1 Run focused web-console Vitest coverage for the changed tests.
- [x] 4.2 Run `openspec validate fix-807-console-create-form-validation --strict` if the OpenSpec
  CLI is available in this worktree.
- [x] 4.3 Review `git diff` for scope, contract drift, and accidental secrets before committing.
