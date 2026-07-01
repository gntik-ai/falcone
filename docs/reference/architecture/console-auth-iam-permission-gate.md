# Console Auth/IAM Permission Gate

`/console/auth` is currently a platform administration surface. It loads platform IAM inventory such
as realm roles, OAuth clients, scopes, federated providers, and external applications through routes
that are superadmin-only in the current control-plane authorization model.

Because the backend does not yet grant tenant owners scoped own-realm role/client administration on
those routes, the web console treats `/console/auth` as superadmin-only:

- the Auth navigation item is visible only to sessions whose `platformRoles` include `superadmin`;
- direct non-superadmin access to `/console/auth` is redirected to `/console/my-plan` before the Auth
  page mounts;
- the page must not be shown to tenant owners as an actionable destination that can only render
  `403 requires superadmin`.

Tenant-owner user and role administration should use tenant/member-oriented surfaces where their
permissions are explicitly supported, such as Members for tenant realm users and roles and the
tenant membership/invitation APIs. Do not direct tenant owners to IAM Access as an alternative while
that console route remains superadmin-gated. Future scoped IAM work can add tenant-owner own-realm
role/client management, but it must do so by changing the backend authorization model and documenting
the new supported route contract rather than reusing the superadmin-only platform page unchanged.
