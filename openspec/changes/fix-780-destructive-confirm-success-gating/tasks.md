## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `a817b9fc`):
  `DestructiveConfirmationDialog.tsx:139-142` does
  `await Promise.resolve(onConfirm()); config.onSuccess?.()`. The two real callers
  (`ConsoleServiceAccountsPage.tsx:192`, `ConsoleAuthPage.tsx:828`) pass
  `onConfirm={() => void destructiveOp.handleConfirm()}`, so `onConfirm()` returns `undefined`,
  `await Promise.resolve(undefined)` settles on the next microtask, and `config.onSuccess?.()`
  fires unconditionally — before the real op (awaited inside `useDestructiveOp.handleConfirm`,
  lines 98-113) settles. The hook already fires `onSuccess` once on success (108) and on failure
  sets `confirmError`/`opState='error'` with no `onSuccess`. → success double-fires `onSuccess`
  (double reload); failure shows false "success" feedback (incl. a failed credential revoke).
- [x] 1.2 Rewrite the existing unit test `DestructiveConfirmationDialog.test.tsx` `[RC-07]`
  (which asserted the dialog itself calls `config.onSuccess` — the bug) to assert the corrected
  presentational contract: clicking Confirm calls the `onConfirm` prop exactly once and does NOT
  independently call `config.onSuccess`. Keep the test id/prefix `[RC-07] … RF-UI-026 / T03-AC7`.
- [x] 1.3 Add a new composition test
  `DestructiveConfirmationDialog.integration.test.tsx` that wires the REAL `useDestructiveOp`
  hook to the REAL dialog exactly as the pages do (`onConfirm={() => void handleConfirm()}`),
  nothing mocked, `level: 'WARNING'` (no confirmation-text input, no cascade fetch):
  - Scenario A (failure): `onConfirm` rejects → assert `role="alert"` shows the error and
    `onSuccess` is NOT called. RED on `main` (dialog fires `onSuccess` unconditionally).
  - Scenario B (success): `onConfirm` resolves → assert `onSuccess` called exactly once. RED on
    `main` (dialog + hook both fire it → twice).

## 2. Fix

- [x] 2.1 `DestructiveConfirmationDialog.tsx`: change the destructive confirm button's `onClick`
  from the `async` handler that awaits + calls `config.onSuccess?.()` to `onClick={() => onConfirm()}`.
  Remove the `config.onSuccess?.()` call entirely. Keep `config` (still used for rendering).
- [x] 2.2 Leave the callers unchanged: `ConsoleServiceAccountsPage.tsx` and `ConsoleAuthPage.tsx`
  keep `onConfirm={() => void destructiveOp.handleConfirm()}` (now harmless — the dialog no longer
  awaits it). Leave the inert stub in `ConsolePlanDetailPage.tsx` and the dead import in
  `ConsolePlanCreatePage.tsx` as-is.

## 3. Wire / contract / docs

- [x] 3.1 No OpenAPI/contract/SDK change — frontend-only behavioral fix; no `*.openapi.json`,
  generated types, `internal-contracts`, `public-route-catalog.json`, or gateway config edited.
  Codegen produces no diff.
- [x] 3.2 Docs: document the corrected destructive-confirmation contract (the hook owns the op
  lifecycle; the dialog is presentational) under `docs/reference/architecture/`.
- [x] 3.3 Spec delta:
  `openspec/changes/fix-780-destructive-confirm-success-gating/specs/web-console/spec.md` —
  `## ADDED Requirements` (NOT MODIFIED) under the `web-console` capability, because no base
  requirement in `openspec/specs/web-console/spec.md` covers the destructive-confirmation dialog.
  One requirement with two WHEN/THEN scenarios (failure → error, no success; success → success
  feedback + single reload).

## 4. Verify

- [ ] 4.1 CI runs the `web-console` vitest job — the rewritten `[RC-07]` test and the new
  integration test are the executed regression gate. Local vitest execution is gated in this
  environment; CI is the authoritative check.
- [x] 4.2 Confirm `git diff --name-only origin/main...HEAD` touches only files under
  `apps/web-console/src/`, `docs/`, and
  `openspec/changes/fix-780-destructive-confirm-success-gating/` (force-added past `.gitignore`).
  No contract/SDK/openapi/route-catalog artifacts → codegen no-diff.
- [ ] 4.3 `openspec validate fix-780-destructive-confirm-success-gating --strict` (if the CLI is
  available — gated in this environment).
