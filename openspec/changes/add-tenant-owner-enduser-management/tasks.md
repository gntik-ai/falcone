# Tasks — add-tenant-owner-enduser-management

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: as a tenant_owner, listing the project's end-users -> 403; disable/delete are superadmin-only.

## Implement (kind runtime AND shippable product as applicable)
- [ ] A project-scoped end-user management API authorized for the owning tenant.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: An owner lists/disables/deletes only its own project's end-users; cross-tenant denied.

## Archive
- [ ] `openspec validate add-tenant-owner-enduser-management --strict`; `/opsx:archive add-tenant-owner-enduser-management` after merge.
