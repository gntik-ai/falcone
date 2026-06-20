## 1. Failing black-box test

- [x] 1.1 Add a test driving `LOCAL_HANDLERS.promoteWorkspace` with a stubbed pool: promoting a dev workspace (2 functions) into a prod workspace registers both in the target, skips a name already present in the target, never writes the source, and reports `notCopied` (secrets/credentials/service-accounts); cross-tenant target → 404, same-environment → 400, environment mismatch → 409. RED before: no `promoteWorkspace` handler (`TypeError: ... is not a function`). — `tests/blackbox/workspace-environment-promotion.test.mjs` (8 tests, green).
- [x] 1.2 Add a real-Postgres test (tests/env): two real workspaces (dev + prod) under a tenant; promote functions dev → prod; assert the prod registry gains them, the dev registry is unchanged, and re-running skips. — `tests/env/executor/workspace-environment-promotion.test.mjs` (2 tests, green vs live Postgres on :55432).

## 2. Implement promotion

- [x] 2.1 Add `promoteWorkspace(ctx)` to `deploy/kind/control-plane/b-handlers.mjs`: resolve-then-gate source + target (404 on missing/cross-tenant, no existence leak); validate `targetEnvironment` against `ENVIRONMENT_CATALOG`; reject same-environment (400), same-workspace (400), and environment mismatch (409); copy `store.listFunctions` of the source into the target via `store.insertFunction`, skipping names already present; never copy secrets/credentials/service-accounts; return the promotion summary with `promoted`/`skipped`/`notCopied`. Exported in `LOCAL_HANDLERS`.
- [x] 2.2 Register the route `POST /v1/workspaces/{workspaceId}/promotions` → `promoteWorkspace` (auth `authenticated`) in `deploy/kind/control-plane/routes.mjs`.
- [x] 2.3 Audit the action: added `promoteWorkspace: 'workspace.promote'` to `AUDITABLE_LOCAL_HANDLERS` in `deploy/kind/control-plane/audit-writer.mjs`.

## 3. Verify

- [x] 3.1 Run the new tests (black-box 8/8 + real-Postgres 2/2) — green.
- [x] 3.2 Run `bash tests/blackbox/run.sh` — 1062/1062 pass, no regressions (additive route/handler). CI quality suites also green: `tests/unit` 707 pass, `tests/contracts` 235 pass (skips are pre-existing env-gated).
