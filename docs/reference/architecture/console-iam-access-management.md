# Console IAM Access Management

`/console/iam-access` is the superadmin-only IAM management surface for the active tenant realm.
It complements tenant-facing member pages by exposing platform-operator controls over realm
principals and the role/group catalog they are assigned from.

## Supported UI actions

The page lets a superadmin:

- create a realm user through `POST /v1/iam/realms/{realmId}/users`;
- suspend or enable a realm user through `PATCH /v1/iam/realms/{realmId}/users/{userId}/status`;
- delete a realm user through `DELETE /v1/iam/realms/{realmId}/users/{userId}`;
- create a realm role through `POST /v1/iam/realms/{realmId}/roles`;
- create a realm group through `POST /v1/iam/realms/{realmId}/groups`;
- assign and remove realm roles through the existing user role-assignment routes;
- add and remove user group membership through the existing user group routes.

User creation posts the documented IAM create-user fields used by the runtime: required `username`,
optional `email`, `enabled: true`, `emailVerified: true`, optional
`bootstrapCredentials.temporaryPassword`, and optional `realmRoles` for an initial role. The page
deliberately does not post unsupported create-user fields such as `groups`, `metadata`, or
bootstrap email delivery.

Role creation posts the documented `roleName` field. Group creation posts `name`. User group
membership add/remove routes are path-parameter operations and the page does not send a request
body for those calls.

## Safety and state handling

Membership removals are destructive access changes, so the page uses the shared
`DestructiveConfirmationDialog` / `useDestructiveOp` pattern and does not issue the membership
DELETE until the superadmin confirms. User deletion also uses the destructive confirmation pattern.

The users list is searchable and paginated on the client after loading the realm inventory. Initial
loading, empty, and load-error states use `ConsolePageState`; load failures expose a retry action.
Successful mutations render a polite `aria-live` success announcement and restore keyboard focus to
the initiating control, or to the next relevant selector when the initiating chip/button disappears
after a membership removal, so keyboard and screen-reader users remain oriented after the
post-mutation refetch.

## Contract note

Issue #763 did not require backend implementation changes. The required IAM endpoints already exist
in the control-plane route map, and the console consumes those existing endpoints directly. The
OpenAPI source, public-route catalog, and generated public API family docs publish the existing group
and membership routes so the fuller IAM page is wired to documented API surface.
