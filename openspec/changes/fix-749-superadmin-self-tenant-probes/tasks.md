## 1. Root cause and scope

- [x] 1.1 Confirm the issue body acceptance criteria:
  - a tenant-less `superadmin` must not issue self-tenant `/v1/tenant/*` requests;
  - `/console/my-plan` must show a meaningful platform-admin no-personal-plan state instead of raw
    `TENANT_NOT_FOUND`.
- [x] 1.2 Confirm root cause on `origin/main` `173bec0b`:
  - `apps/web-console/src/lib/console-context.tsx` gated capability loading on `activeTenantId` but
    called `getEffectiveCapabilities()` with no tenant id, selecting `/v1/tenant/effective-capabilities`;
  - `apps/web-console/src/pages/ConsoleTenantPlanOverviewPage.tsx` always called
    `getEffectiveEntitlements(undefined, { includeConsumption: true })`, selecting
    `/v1/tenant/plan/effective-entitlements`.
- [x] 1.3 Scope as frontend-only: existing tenant-id routes already exist and no wire shape changes.

## 2. Implementation

- [x] 2.1 Change `ConsoleContextProvider` to call `getEffectiveCapabilities(activeTenantId)` and keep
  no-active-tenant capability state settled to `{}` / not loading.
- [x] 2.2 Change `/console/my-plan` to detect tenant-less platform principals before loading
  self-entitlements and render `No personal plan (platform admin)`.
- [x] 2.3 Preserve tenant-user My Plan behavior.

## 3. Tests, docs, and OpenSpec

- [x] 3.1 Add a focused `ConsoleContextProvider` test proving a tenant-less superadmin session never
  fetches `/v1/tenant/effective-capabilities`.
- [x] 3.2 Add a focused My Plan test proving tenant-less platform admins see the no-personal-plan
  state, no raw `TENANT_NOT_FOUND`, and no self-entitlements call.
- [x] 3.3 Keep tenant My Plan happy-path coverage.
- [x] 3.4 Add/update docs for console self-tenant behavior and platform-admin My Plan.
- [x] 3.5 Materialize this OpenSpec change under `openspec/changes/fix-749-superadmin-self-tenant-probes/`.

## 4. Verification

- [x] 4.1 Run focused web-console Vitest for the changed tests.
- [x] 4.2 Run `openspec validate fix-749-superadmin-self-tenant-probes --strict`.
- [x] 4.3 Run `npm run generate:public-api` and confirm it produces no diff.
- [x] 4.4 Run `git diff --check`.
