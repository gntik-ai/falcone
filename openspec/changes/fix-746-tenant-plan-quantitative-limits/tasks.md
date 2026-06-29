## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `6e0f71ad`):
  `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx:31` reads
  `summary.quotaDimensions.map(...)` and `item.observedUsage`, but the
  effective-entitlements API (`services/provisioning-orchestrator/src/models/effective-entitlements.mjs`
  `EffectiveEntitlementProfile`) returns `quantitativeLimits` (per-item `currentUsage`),
  never `quotaDimensions`/`observedUsage`. So `summary.quotaDimensions` is `undefined` →
  `.map` throws `TypeError: Cannot read properties of undefined (reading 'map')`. The
  superadmin route `tenants/:tenantId/plan` (router.tsx:191-192) mounts this component.
- [x] 1.2 Update the regression test
  `apps/web-console/src/pages/ConsoleTenantPlanPage.test.tsx`:
  - Change the `getEffectiveEntitlements` mock to resolve the REAL API shape — drop
    `quotaDimensions`, return `quantitativeLimits: [ <one populated entry> ]`
    (`{ dimensionKey, displayLabel: 'Flow signal rate', unit, effectiveValue, source,
    quotaType, currentUsage, usageStatus }`), plus `capabilities: []`, `planSlug`,
    `planStatus`.
  - Keep the 'Starter' plan-name and change-plan-button assertions; add
    `expect(await screen.findByText('Flow signal rate')).toBeInTheDocument()` asserting the
    limit row renders from `quantitativeLimits`.
  - On buggy code: `summary.quotaDimensions` is undefined → `.map` throws during render →
    test errors (RED). On fixed code: reads `quantitativeLimits` → row renders (GREEN). The
    asserted text comes from the mocked entry (not tautological).

## 2. Fix (minimal, frontend conforms to existing backend contract)

- [x] 2.1 `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx` — change
  `summary.quotaDimensions.map(...)` → `(summary.quantitativeLimits ?? []).map(...)` and
  `currentUsage: item.observedUsage ?? null` → `currentUsage: item.currentUsage ?? null`.
  No other restructuring; `source: 'plan'` unchanged.
- [x] 2.2 `apps/web-console/src/services/planManagementApi.ts` — add an optional,
  correctly-typed `quantitativeLimits?: Array<{ dimensionKey; displayLabel?; unit?;
  effectiveValue?; source?; quotaType?; currentUsage?; usageStatus; usageUnknownReason? }>`
  field to `CurrentEffectiveEntitlementSummary` (mirrors backend `QuantitativeLimitEntry`).
  Keep the legacy `quotaDimensions` field unchanged with a clarifying comment.
- [x] 2.3 HARD SCOPE GUARD: do NOT edit
  `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` or its test — that is
  issue #735's scope (a distinct route/persona).

## 3. Wire / contract / docs

- [x] 3.1 No contract artifact changed — the fix conforms the frontend to the EXISTING
  backend contract. No `*.openapi.json`, generated types, `internal-contracts`, route
  catalog, or gateway config edited; re-running codegen yields no diff.
- [x] 3.2 Docs: add
  `docs/reference/architecture/console-effective-entitlements-mapping.md` documenting that
  the console reads per-tenant effective quota limits from the API's `quantitativeLimits`
  field (per-item `currentUsage`) on the superadmin `/console/tenants/{tenantId}/plan` page,
  and guards absent fields.
- [x] 3.3 Spec delta:
  `openspec/changes/fix-746-tenant-plan-quantitative-limits/specs/web-console/spec.md` —
  `## ADDED Requirements` (NOT MODIFIED; no existing requirement in
  `openspec/specs/web-console/spec.md` covers the superadmin per-tenant plan page reading
  effective quota limits) with WHEN/THEN scenarios matching the acceptance criteria.

## 4. Verify

- [ ] 4.1 CI runs the `web-console` vitest job — the updated test is the executed
  regression gate (local vitest/tsc execution is gated in this environment; CI is the
  authoritative check).
- [ ] 4.2 Confirm `git diff --name-only origin/main...HEAD` touches only:
  `apps/web-console/src/pages/ConsoleTenantPlanPage.tsx`,
  `apps/web-console/src/services/planManagementApi.ts`,
  `apps/web-console/src/pages/ConsoleTenantPlanPage.test.tsx`, the three
  `openspec/changes/fix-746-tenant-plan-quantitative-limits/` files (force-added past
  `.gitignore`), and the docs file — and NOT `ConsoleTenantPlanOverviewPage*`.
- [ ] 4.3 `openspec validate fix-746-tenant-plan-quantitative-limits --strict` (if the CLI
  is available without approval).
