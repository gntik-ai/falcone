## 1. Data layer — spec-version-repo

- [x] 1.1 Add `AND tenant_id = $N` predicate to `getCurrentSpec` in `services/openapi-sdk-service/src/spec-version-repo.mjs`
- [x] 1.2 Add `AND tenant_id = $N` predicate to `getSpecHistory` in `spec-version-repo.mjs`
- [x] 1.3 Add `AND tenant_id = $N` predicate to the UPDATE path of `insertNewSpec` in `spec-version-repo.mjs`

## 2. Data layer — sdk-package-repo

- [x] 2.1 Add `AND tenant_id = $N` predicate to `getSdkPackage` in `services/openapi-sdk-service/src/sdk-package-repo.mjs` (currently filters only by `workspace_id` and `language`)
- [x] 2.2 Add `AND tenant_id = $N` predicate to the SELECT check inside `upsertSdkPackage`
- [x] 2.3 Add `AND tenant_id = $N` predicate to `markStaleSdkPackages`

## 3. App layer — handleStatusCheck authentication

- [x] 3.1 In `services/openapi-sdk-service/actions/sdk-generate.mjs::handleStatusCheck:27-52`, read the tenant identity from `x-auth-tenant-id` / `x-tenant-id` header
- [x] 3.2 Return HTTP 401 when no tenant identity header is present
- [x] 3.3 Pass the resolved `tenantId` to `getSdkPackage` so the data-layer predicate is applied

## 4. App layer — handleGenerateRequest cross-tenant guard

- [x] 4.1 In `services/openapi-sdk-service/actions/sdk-generate.mjs::handleGenerateRequest:54-114`, after the `getCurrentSpec` call (line 68), add `if (spec.tenantId !== tenantId) { return 403 }`, mirroring `services/openapi-sdk-service/actions/openapi-spec-serve.mjs:53-55`

## 5. Preserve existing guard in openapi-spec-serve

- [x] 5.1 Verify that the existing guard at `services/openapi-sdk-service/actions/openapi-spec-serve.mjs:53-55` remains intact and add a test assertion covering it

## 6. Verification

- [x] 6.1 Add black-box test `bbx-sdk-unauth-status-01`: unauthenticated GET to status endpoint returns HTTP 401
- [x] 6.2 Add black-box test `bbx-sdk-cross-tenant-generate-01`: authenticated tenant A targeting tenant B's `workspaceId` on generate returns HTTP 403/404
- [x] 6.3 Add black-box test: authenticated tenant A targeting their own `workspaceId` on generate returns expected success response
- [x] 6.4 Run `bash tests/blackbox/run.sh` and confirm green
