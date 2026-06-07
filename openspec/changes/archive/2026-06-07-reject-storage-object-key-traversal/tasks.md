## 1. Syntactic rejection in assertObjectKey

- [x] 1.1 Extend `services/adapters/src/storage-bucket-object-ops.mjs::assertObjectKey:50-59` to split the key on `/` and reject any segment equal to `..`
- [x] 1.2 Extend `assertObjectKey` to reject keys containing a backslash character (`\`)
- [x] 1.3 Extend `assertObjectKey` to reject keys containing control characters (0x00–0x1F, 0x7F)
- [x] 1.4 Throw `STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY` for all three new conditions, consistent with the existing validator behavior

## 2. Containment re-assertion in buildStorageObjectOrganization

- [x] 2.1 In `services/adapters/src/storage-logical-organization.mjs::buildStorageObjectOrganization:154-158`, after computing `canonicalObjectPath`, normalize the path and assert it begins with `objectPrefix`
- [x] 2.2 On containment failure throw `INVALID_OBJECT_KEY` and abort before any storage I/O; this is defense-in-depth independent of backend normalization behavior

## 3. Verification

- [x] 3.1 Add black-box test `bbx-storage-traversal-01`: key `uploads/../../tenants/tenant-b/workspaces/ws-b/secret` returns HTTP 400 `INVALID_OBJECT_KEY` on object create
- [x] 3.2 Add black-box test `bbx-storage-traversal-02`: same traversal key returns HTTP 400 on presigned URL generation
- [x] 3.3 Add black-box test: key `uploads/2026/report.pdf` (legitimate forward-slash key) succeeds with HTTP 2xx
- [x] 3.4 Add black-box test: key containing a backslash returns HTTP 400 `INVALID_OBJECT_KEY`
- [x] 3.5 Run `bash tests/blackbox/run.sh`
