# Tasks — fix-activate-seaweedfs-tenant-identities

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Deployed control-plane pod env has only STORAGE_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY (no STORAGE_TENANT_IDENTITIES); direct S3 admin cred lists/reads/writes both tenants' buckets.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Ensure the flag is set in every profile (or default-on); verify the per-workspace identity provision/rotate/revoke path issues real per-tenant SeaweedFS credentials and the storage API vends them.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Each workspace gets a distinct S3 identity scoped to its bucket prefix; tenant A's S3 credential cannot access tenant B's buckets.

## Archive
- [ ] `openspec validate fix-activate-seaweedfs-tenant-identities --strict`; `/opsx:archive fix-activate-seaweedfs-tenant-identities` after merge.
