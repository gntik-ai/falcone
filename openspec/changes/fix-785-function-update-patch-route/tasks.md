## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `eeb5dba9`): the kind control-plane registers the by-id
  function-update route as `PUT` only (`deploy/kind/control-plane/routes.mjs:266`), while the console
  submits `PATCH /v1/functions/actions/{id}`
  (`apps/web-console/src/pages/ConsoleFunctionsPage.tsx:649-650`) and all three contract artifacts
  declare `PATCH`/`updateFunctions`. `matchRoute` (`deploy/kind/control-plane/server.mjs:117-124`) is
  exact-method → the PATCH request returns `null` → server answers `404 NO_ROUTE`.
- [x] 1.2 Confirm there is no in-repo dependency on `PUT` for `functions/actions`: grep of `tests/`,
  `apps/`, `services/` finds no caller/test asserting `PUT` on `functions/actions` (the only `PUT`
  reference is the unrelated workspace-secrets path and a real-product `endpoint_scope_requirements`
  seed in a different runtime) → a clean replace (PUT → PATCH) is correct, not an alias.
- [x] 1.3 Add regression test `tests/unit/function-update-route-method.test.mjs`: import
  `{ routes }` from `deploy/kind/control-plane/routes.mjs`; assert exactly one
  `{ method:'PATCH', path:'/v1/functions/actions/{actionId}', localHandler:'fnDeploy' }` update entry
  and no leftover `PUT`; replicate the kind-CP `compilePath` + `matchRoute` (mirrored verbatim from
  `server.mjs`) and assert `matchRoute('PATCH', '/v1/functions/actions/act_123')` resolves to
  `fnDeploy` (NOT null → NOT 404 NO_ROUTE); assert the registered method equals the
  `updateFunctions` method read from `public-route-catalog.json`. RED on `main`, GREEN on the branch.

## 2. Fix (minimal, kind-runtime drift)

- [x] 2.1 `deploy/kind/control-plane/routes.mjs:266` — change the by-id update route for
  `/v1/functions/actions/{actionId}` from `method: 'PUT'` to `method: 'PATCH'` (keep
  `localHandler: 'fnDeploy'`, `auth: 'authenticated'`). Replace the PUT (do not keep it).
- [x] 2.2 `deploy/kind/control-plane/fn-handlers.mjs` — update the stale route comment above
  `fnDeploy` from `PUT` to `PATCH` so the in-code documentation matches the route. No handler logic
  changed (`fnDeploy` already branches create-vs-update on `ctx.params.actionId`, method-agnostic).

## 3. Wire / contract / docs

- [x] 3.1 No OpenAPI/contract/SDK change — all three contract artifacts already declare `PATCH` for
  `updateFunctions`; re-running codegen produces no diff. No frontend change —
  `ConsoleFunctionsPage.tsx` already submits `PATCH`.
- [x] 3.2 Docs: checked `docs/reference/architecture/public-api-surface.md` and the functions API
  reference — they already describe `PATCH` for the function update (no doc states `PUT` for
  `/v1/functions/actions/{id}`), so no doc change is required.
- [x] 3.3 Spec delta: `openspec/changes/fix-785-function-update-patch-route/specs/functions/spec.md`
  — `## ADDED Requirements` (NOT MODIFIED) under the `functions` capability (no existing requirement
  in `openspec/specs/functions/spec.md` covers route/method conformance); one new requirement with
  two WHEN/THEN scenarios.

## 4. Verify

- [ ] 4.1 CI runs `pnpm test:unit` (`node --test tests/unit/*.test.mjs`) — the new test is the
  executed regression gate. Local node/pnpm execution is gated in this environment; CI on the PR is
  the authoritative check.
- [ ] 4.2 Confirm `git diff --name-only origin/main...HEAD` touches only
  `deploy/kind/control-plane/routes.mjs`, `deploy/kind/control-plane/fn-handlers.mjs`, the new test,
  and the `openspec/changes/fix-785-function-update-patch-route/` files (force-added past
  `.gitignore`). No contract/OpenAPI/SDK/frontend file.
- [ ] 4.3 `openspec validate fix-785-function-update-patch-route --strict` (if the CLI is available;
  otherwise CI validates).
