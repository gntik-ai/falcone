## 1. Confirm Baseline and Scope

- [x] 1.1 Confirm issue #763 root cause: `ConsoleIamAccessPage` only assigned/removed role and
  group memberships for existing users.
- [x] 1.2 Confirm backend routes already exist for user create/delete/status and role/group create
  in `deploy/kind/control-plane/routes.mjs`.
- [x] 1.3 Confirm no new backend route surface is required because the console consumes existing IAM
  endpoints, while the public API artifacts must publish the existing group and membership endpoints
  now exposed by the fuller UI.

## 2. Implement

- [x] 2.1 Add create-user UI that posts to `POST /v1/iam/realms/{realmId}/users`.
- [x] 2.2 Add enable/suspend and delete-user controls for realm users.
- [x] 2.3 Add create-role and create-group forms that refresh the catalog and make new entries
  assignable.
- [x] 2.4 Confirm role and group membership removals with `DestructiveConfirmationDialog` /
  `useDestructiveOp` before DELETE.
- [x] 2.5 Add searchable/paginated users, retryable `ConsolePageState` load/empty/error handling,
  success announcement, and focus restoration after mutation refetch.

## 3. Tests

- [x] 3.1 Cover user lifecycle actions and exact existing IAM endpoints.
- [x] 3.2 Cover role/group creation and immediate assignment.
- [x] 3.3 Cover confirmed role and group membership removal.
- [x] 3.4 Cover user search, pagination, empty search state, load error retry, success
  announcement, and focus restoration.
- [x] 3.5 Preserve existing sanitized IAM mutation error coverage.

## 4. Docs / OpenSpec / Validation

- [x] 4.1 Add this OpenSpec change and web-console spec delta.
- [x] 4.2 Add reference documentation for `/console/iam-access` lifecycle behavior.
- [x] 4.3 Publish the existing IAM group and membership routes in OpenAPI, public route catalog, and
  generated public API docs.
- [x] 4.3a Align the existing kind control-plane create-role handler with the documented `roleName`
  payload.
- [x] 4.4 Run `pnpm --dir apps/web-console test src/pages/ConsoleIamAccessPage.test.tsx`.
- [x] 4.5 Run `openspec validate add-763-superadmin-iam-access-management --strict`.
- [x] 4.6 Run `npm run generate:public-api` / `npm run validate:public-api`.
- [x] 4.7 Run `git diff --check`.
