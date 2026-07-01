# Console Auth/IAM Permission Gate

`/console/auth` and `/console/iam-access` are currently platform administration surfaces. Auth loads
platform IAM inventory such as realm roles, OAuth clients, scopes, federated providers, and external
applications through routes that are superadmin-only in the current control-plane authorization
model. IAM Access is guarded by the same superadmin-only console route policy.

Because the backend does not yet grant tenant owners scoped own-realm role/client administration on
those routes, the web console treats both platform IAM pages as superadmin-only:

- the Auth and IAM Access navigation items are visible only to sessions whose `platformRoles` include
  `superadmin`;
- direct non-superadmin access to `/console/auth` and `/console/iam-access` is redirected to
  `/console/my-plan` before the platform IAM page mounts;
- neither page must be shown to tenant owners as an actionable destination that can only render `403
  requires superadmin`.

Tenant-owner user and role administration should use tenant/member-oriented surfaces where their
permissions are explicitly supported, such as Members for tenant realm users and roles and the
tenant membership/invitation APIs. Do not direct tenant owners to IAM Access as an alternative while
that console route remains superadmin-gated and hidden from their navigation. Future scoped IAM work
can add tenant-owner own-realm role/client management, but it must do so by changing the backend
authorization model and documenting the new supported route contract rather than reusing the
superadmin-only platform pages unchanged.
