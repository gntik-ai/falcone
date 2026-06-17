## 1. Failing black-box test

- [x] 1.1 Add a black-box test: Tenant B's credential lists/reads Tenant A's bucket/workspace by id, asserting HTTP 404 (no existence leak). Confirm RED.
      File: `tests/blackbox/storage-bucket-ownership-idor.test.mjs` (bbx-stor-idor-01…04, 08).
      RED confirmed before fix: tests 01-04 and 08 failed with HTTP 200 (IDOR).
- [ ] 1.2 Add a black-box test: a per-tenant storage credential cannot reach another tenant's prefix.
      DEFERRED — see task 2.2 below. No per-tenant S3 identity issuance is implemented;
      the test would duplicate bbx-swfs-id-9.4 (already in seaweedfs-tenant-identities.test.mjs)
      which covers the IAM-client layer in isolation.

## 2. Fix storage handlers + identity

- [x] 2.1 In `storage-handlers.mjs`, add `isSuperOrInternal()` gate and enforce ownership on every
      storage route:
      - `storageListBuckets`: filter `items` by `item.tenantId === identity.tenantId` for non-superadmin.
      - `storageListObjects`: look up bucket via `store.getBucketRecord(pool, bucket)`; if missing or
        `tenant_id !== identity.tenantId` → 404 BUCKET_NOT_FOUND.
      - `storageObjectMetadata`: same ownership check as storageListObjects.
      - `storageWorkspaceUsage`: look up workspace via `store.getWorkspace(pool, workspaceId)`; if missing
        or `tenant_id !== identity.tenantId` → 404 WORKSPACE_NOT_FOUND.
      - `storageProvisionBucket`: after `getWorkspace` succeeds, reject cross-tenant workspaces with
        404 WORKSPACE_NOT_FOUND (no existence leak).
      Added `getBucketRecord(pool, bucketName)` to `tenant-store.mjs` (SELECT by `bucket_name`).
      Superadmin/internal bypass all ownership gates (cross-tenant access preserved).
- [ ] 2.2 Provision per-tenant SeaweedFS identities and bucket policies (or server-enforced per-tenant
      prefixes); stop issuing a platform-wide admin key for tenant I/O.
      DEFERRED — not tractable as a pure app-code change in the kind runtime. The single shared
      `in-falcone-seaweedfs-s3-creds` credential is baked into the Helm chart secret and the
      SeaweedFS IAM configuration. Implementing per-tenant identities requires:
        (a) A SeaweedFS IAM account per tenant/workspace provisioned at workspace-create time
            (the `add-seaweedfs-tenant-identities` change covers the adapter layer; it needs
            to be wired into the storageProvisionBucket path and the Helm chart must expose
            the SeaweedFS weed-shell/IAM endpoint to the control-plane).
        (b) The shared admin key must be retained only for provisioning, not for tenant data I/O.
      The IDOR at the REST-API layer (the proven exploitable bug) is fully fixed by task 2.1.
      BUG-STOR-3 (blast-radius from single shared key) remains open as a follow-up.

## 3. Verify

- [x] 3.1 Re-run the cross-tenant black-box test — confirmed GREEN (10/10) after fix.
      bbx-stor-idor-01…10 all pass. Own-bucket access and superadmin cross-tenant access
      still work (tests 05-07, 09-10).
- [x] 3.2 Run `bash tests/blackbox/run.sh` — 0 failures, no regressions.
      Also ran `tests/unit/storage-handlers-xml-parsing.test.mjs` — 5/5 pass.
      Also ran all storage-related blackbox suites — 39/39 pass.
