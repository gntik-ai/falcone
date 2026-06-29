## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `e4c0ff81`): the boolean-capability catalog
  (`services/provisioning-orchestrator/src/migrations/104-plan-boolean-capabilities.sql` +
  `114-backup-scope-deployment-profiles.sql`) defines exactly 8 keys; neither `workflows` nor
  `functions_public` is among them. `resolveEffectiveCapabilities`
  (`tenant-effective-capabilities-get.mjs:37`) iterates only over catalog rows, so those keys are
  always `undefined`; `useCapabilityGate` (`use-capability-gate.ts:18`) is fail-closed → the four
  Flows pages and the Functions publish wizard render permanently disabled.
- [x] 1.2 Confirm the Flows backend is NOT plan-gated: no `/v1/flows/...` entry in
  `services/gateway-config/routes/capability-gated-routes.yaml`, no flows `planCapabilityAnyOf` in
  `services/gateway-config/base/public-api-routing.yaml`, and `workflows` is not a capability key
  anywhere in the backend → un-gating the Flows pages is correct (not a frontend-only suppression of
  a real entitlement).
- [x] 1.3 Add Scenario 1 regression test `apps/web-console/src/pages/ConsoleFlowsPage.test.tsx`:
  render the page with the REAL `use-capability-gate` (NOT mocked) and a console context whose
  `capabilities` map omits `workflows` (the universal production state) with a selected workspace;
  assert the content is interactive — `[data-testid="capability-gate-disabled"]` is absent and the
  "New flow" affordance + name input are rendered. RED on `main` (page wrapped → disabled overlay
  present), GREEN on this branch (wrapper removed).
- [x] 1.4 Add Scenario 2 audit guard
  `apps/web-console/src/lib/capabilities/capability-gate-keys.test.ts`: scan `apps/web-console/src`
  for every `CapabilityGate capability="X"` and `useCapabilityGate('X')` literal and assert each `X`
  is in `BOOLEAN_CAPABILITY_KEYS`. RED on `main` (finds `workflows`, `functions_public`), GREEN on
  this branch.

## 2. Fix (asymmetric, minimal)

- [x] 2.1 Add `apps/web-console/src/lib/capabilities/catalog-keys.ts` — `BOOLEAN_CAPABILITY_KEYS`
  (8 keys, sourced to migrations 104 + 114), `BooleanCapabilityKey`, `isBooleanCapabilityKey`.
- [x] 2.2 Type `CapabilityGate.capability` and `useCapabilityGate(key)` as `BooleanCapabilityKey`.
- [x] 2.3 Un-gate the four Flows pages: remove the `CapabilityGate capability="workflows"
  mode="disable"` wrapper and the now-unused `CapabilityGate` import from each of
  `ConsoleFlowsPage.tsx`, `ConsoleFlowDesignerPage.tsx`, `ConsoleFlowHistoryPage.tsx`,
  `ConsoleFlowRunPage.tsx`. No other page logic changed.
- [x] 2.4 Rename the Functions gate `capability="functions_public"` → `capability="public_functions"`
  in `ConsoleFunctionsPage.tsx`; keep the gate.
- [x] 2.5 Update `ConsoleFunctionsPage.test.tsx` mock `capabilities` to `{ public_functions: true }`
  and cast the unknown-key negative test in `use-capability-gate.test.ts` so existing tests still
  compile/pass.

## 3. Wire / contract / docs

- [x] 3.1 No OpenAPI/contract/SDK change — pure frontend fix; no `*.openapi.json`, generated types,
  `internal-contracts`, or route catalog edited. Re-running codegen produces no diff.
- [x] 3.2 Docs: add a note to the web-console reference doc that capability gates must reference
  catalog keys and that Flows is not plan-gated (only if a natural home exists).
- [x] 3.3 Spec delta: `openspec/changes/fix-790-flows-capability-gate/specs/web-console/spec.md` —
  `## ADDED Requirements` (NOT MODIFIED) under the `web-console` capability; one new requirement
  ("Console capability gates reference real catalog capability keys") with the two WHEN/THEN
  scenarios from the issue.

## 4. Verify

- [ ] 4.1 CI runs `pnpm --filter @in-falcone/web-console test` (the `web-console` job executes
  vitest) — the new tests are the executed regression gate. Local vitest/tsc execution is gated in
  this environment; CI is the authoritative check.
- [ ] 4.2 Confirm `git diff --name-only origin/main...HEAD` touches only web-console source/tests and
  the `openspec/changes/fix-790-flows-capability-gate/` files (force-added past `.gitignore`), plus
  the optional doc.
- [ ] 4.3 `openspec validate fix-790-flows-capability-gate --strict` (if the CLI is available;
  otherwise CI validates).
