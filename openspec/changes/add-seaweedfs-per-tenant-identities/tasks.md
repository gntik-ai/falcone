# Tasks — add-seaweedfs-per-tenant-identities

> SCOPE NOTE (orchestrator): landed as a **non-regressing scaffolding slice**. The
> per-tenant identity MODEL + namespacing builder + chart scaffolding ship and are
> tested; the LIVE master-key retirement (issuing per-workspace scoped credentials at
> runtime and confining/removing the shared admin key) is deferred to
> **epic-seaweedfs-migration (#430)** — confining the admin/service identity here
> would break the (already tenant-gated) storage REST API, since that same key backs
> the control-plane's `STORAGE_S3_*` credential. See the chart comment in
> `seaweedfs-s3-creds.yaml` for the rationale.

## Reproduce (test-first)
- [x] Failing black-box test over the public builder surface: `tests/blackbox/seaweedfs-per-tenant-identities.test.mjs` (bbx-swfs-pti-01..05). RED before the builder module existed; GREEN after. Asserts tenant/workspace bucket namespacing is collision-free + DNS-safe and a per-workspace identity is scoped ONLY to its own bucket.

## Implement (shippable product + deploy wiring)
- [x] Pure namespacing + identities-config builders (`services/adapters/src/seaweedfs-s3-identities-config.mjs`): `deriveWorkspaceBucketName` (collision-free `t-<tenantHash>-<workspaceHash>` names) + `buildSeaweedFSIdentitiesConfig` (fail-closed, per-bucket-scoped). Reuses the existing `buildSeaweedFSIdentity` scoping/validation.
- [x] Chart scaffolding: `seaweedfsS3Creds.platformBucketPrefix` + `adminEndpoint` + `adminAccessKey/adminSecretKey` for the runtime IAM client; reserved platform bucket (`charts/in-falcone/values.yaml`, `seaweedfs-s3-creds.yaml`).
- [x] Confirmed the per-tenant identity MODEL (issue/scope/rotate/revoke) already ships from epic-430 child `add-seaweedfs-tenant-identities` (`seaweedfs-iam-client.mjs`, `storage-identity-runtime.mjs`, `bucket-reconciler.mjs`); reused, not rebuilt.
- [x] CORRECTION (orchestrator): the chart admin/service identity is kept BROAD (not confined), because it is also the control-plane's `STORAGE_S3_*` credential that provisions/serves every tenant's bucket behind the tenant-gated REST API. Confining it (the agent's first pass) regresses storage. The confinement + per-workspace credential ISSUANCE at provision time + retiring the master key are the live cutover → **deferred to #430**.

## Verify
- [x] New black-box file green (`node --test tests/blackbox/seaweedfs-per-tenant-identities.test.mjs` → 5/5); `helm template` renders cleanly (admin identity broad, storage REST API unaffected).
- [ ] DEFERRED to #430 (not in this slice): live 2-tenant probe that a per-workspace credential is denied cross-tenant + the shared admin key no longer exists. (The storage REST API isolation already HOLDS empirically — report §3a.)

## Archive
- [ ] `openspec validate add-seaweedfs-per-tenant-identities --strict`; archive in the batch. NOTE: GitHub #553 should remain OPEN (or be re-pointed at #430) since the live breach closure is deferred — the orchestrator will NOT auto-close it.
