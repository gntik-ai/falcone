# Tasks — fix-storage-bucket-tenant-scope

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Two tenants `POST /v1/storage/workspaces/{ws}/buckets` with no explicit name (both ws slug `app-staging`) -> second create hijacks the first's registry row; first tenant's bucket list drops to 0.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Include the workspace id in the physical bucket name; key the registry by `(workspace_id, bucket_name)`; never let `ON CONFLICT` cross tenant_id.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Same-slug workspaces across tenants get distinct buckets; neither can hijack the other's registry row.

## Archive
- [ ] `openspec validate fix-storage-bucket-tenant-scope --strict`; `/opsx:archive fix-storage-bucket-tenant-scope` after merge.
