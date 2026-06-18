# Tasks — add-seaweedfs-per-tenant-identities

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: aws-sdk → `http://.

## Implement (kind runtime AND shippable product)
- [ ] Issue per-tenant/per-workspace SeaweedFS identities (the SeaweedFS-migration tenant-identities work) and scope each workspace's storage credential; namespace buckets by tenant/workspace.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A workspace credential can only access its own buckets; live cross-tenant S3 probe denied.

## Archive
- [ ] `openspec validate add-seaweedfs-per-tenant-identities --strict`; `/opsx:archive add-seaweedfs-per-tenant-identities` after merge.
