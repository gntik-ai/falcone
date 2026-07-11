## Why

Issue #763 confirmed that `/console/iam-access` was presented as the superadmin IAM management
surface, but only allowed assigning and removing memberships for existing users. The backend already
exposes the required realm user, role, and group lifecycle routes, so the gap was in the console:
superadmins had to leave the UI for user creation/deletion/status changes and catalog creation, and
membership removals fired without confirmation.

## What Changes

- Expand `ConsoleIamAccessPage` into a complete superadmin IAM surface for the active tenant realm.
- Add realm-user creation with optional bootstrap password and initial realm role.
- Add user status actions (`enabled` / suspended) and destructive user deletion.
- Add realm role and group creation forms that refresh the catalog and make new entries assignable.
- Gate role/group membership removals through the shared `DestructiveConfirmationDialog` /
  `useDestructiveOp` pattern before issuing DELETE.
- Replace bespoke initial load/empty/error handling with `ConsolePageState` and retry affordances.
- Add client-side search and pagination for the loaded user list.
- Announce successful mutations through an `aria-live` success region and restore keyboard focus to
  the initiating control after mutation refetches.
- Add focused web-console tests for lifecycle routes, catalog creation, confirmed membership
  removal, search/pagination/error retry, and success/focus behavior.
- Add a reference doc for the superadmin IAM access page behavior and route contract.
- Align the existing kind control-plane create-role handler with the documented `roleName`
  payload while preserving legacy `name` compatibility.

## Capabilities

### Modified Capabilities

- `web-console`: ADDED requirement for `/console/iam-access` to manage realm user lifecycle and
  role/group catalog operations while applying standard console safety, state, and accessibility
  patterns.

## Non-Goals

- No new backend route surface; the required `/v1/iam/realms/{realmId}/...` routes already exist.
- OpenAPI, public route catalog, and generated family docs are updated to publish the existing IAM
  group and membership endpoints consumed by this page.
- No role/group deletion UI; issue #763 asks for creation and assignment catalog management.
- No server-side IAM search or cursor pagination; the page provides client-side search/pagination
  over the loaded realm inventory.

## Exit Criteria

- A superadmin can create, suspend/enable, and delete realm users from `/console/iam-access`.
- A superadmin can create realm roles and groups and immediately assign the new entries.
- Role and group membership removal opens a confirmation dialog before DELETE.
- Load failure renders `ConsolePageState` with retry, empty states use `ConsolePageState`, users are
  searchable/paginated, and successful mutations are announced while focus is restored.
- `pnpm --dir apps/web-console test src/pages/ConsoleIamAccessPage.test.tsx`,
  `openspec validate add-763-superadmin-iam-access-management --strict`, and `git diff --check`
  pass.

## Risks and Rollback

- Risk is limited to the superadmin-only IAM Access route and the create-role handler contract. The
  change calls existing IAM endpoints with documented payloads and keeps generated contract
  artifacts aligned.
- Rollback is reverting `ConsoleIamAccessPage` and its focused tests, plus removing this OpenSpec
  change and the reference doc.
