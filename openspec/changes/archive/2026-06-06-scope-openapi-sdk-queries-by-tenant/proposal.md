## Why

Two distinct exploit paths exist in the OpenAPI SDK service (source findings `iso-002`, `iso-007`, `bug-004`):

**Exploit path 1 — unauthenticated IDOR on SDK package status:**
`services/openapi-sdk-service/actions/sdk-generate.mjs::handleStatusCheck:27-52` extracts `workspaceId` from the URL path with no authentication check, no tenant header read, and no tenant predicate. `services/openapi-sdk-service/src/sdk-package-repo.mjs::getSdkPackage:44-52` filters only by `workspace_id` and `language`; `tenant_id` is a column that is never used in reads. Any caller knowing a `workspaceId` receives HTTP 200 with `downloadUrl`, `urlExpiresAt`, `status`, and `specVersion` for any tenant's workspace — no credentials required.

**Exploit path 2 — authenticated cross-tenant spec read and SDK-row poisoning:**
`services/openapi-sdk-service/actions/sdk-generate.mjs::handleGenerateRequest:54-114` reads `tenantId` from the auth header (line 58) but fetches the spec via `getCurrentSpec(pool, workspaceId)` (line 68) without a tenant predicate. `spec.tenantId` is never compared to `tenantId`. A caller authenticated for tenant A can target tenant B's `workspaceId`, read `spec.formatJson` (spec-content disclosure), and `upsertSdkPackage` writes tenant A's `tenantId` against tenant B's `workspaceId` (cross-tenant row poisoning). UPDATE paths in `spec-version-repo.mjs:31` (`insertNewSpec`) and `sdk-package-repo.mjs:72-78` (`markStaleSdkPackages`) also lack `tenant_id` predicates.

The correct guard is already present in `services/openapi-sdk-service/actions/openapi-spec-serve.mjs:53-55`: `if (spec.tenantId !== tenantId) { return 403 }`.

## What Changes

- **Data layer:** add `AND tenant_id = $N` to every SELECT/UPDATE in `services/openapi-sdk-service/src/spec-version-repo.mjs` (`getCurrentSpec`, `getSpecHistory`, `insertNewSpec` UPDATE path) and `services/openapi-sdk-service/src/sdk-package-repo.mjs` (`getSdkPackage`, `upsertSdkPackage` SELECT check, `markStaleSdkPackages`).
- **App layer — handleStatusCheck:** add authentication (read `x-auth-tenant-id` / `x-tenant-id` header); return HTTP 401 if absent; pass `tenantId` to the now-tenant-scoped `getSdkPackage`.
- **App layer — handleGenerateRequest:** add `if (spec.tenantId !== tenantId) { return 403 }` guard after `getCurrentSpec`, mirroring `openapi-spec-serve.mjs:53-55`.
- Preserve and strengthen the existing guard in `openapi-spec-serve.mjs`.

## Capabilities

### New Capabilities

- `openapi-sdk`: Tenant-scoped authentication and data-layer isolation for all OpenAPI SDK status and generate endpoints, ensuring every query and mutation is predicated on the authenticated tenant's identity.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the openapi-sdk capability spec -->

## Impact

- `services/openapi-sdk-service/actions/sdk-generate.mjs` — both action handlers (`handleStatusCheck`, `handleGenerateRequest`) are fix targets.
- `services/openapi-sdk-service/src/spec-version-repo.mjs` — data layer fix; `getCurrentSpec`, `getSpecHistory`, `insertNewSpec` gain `tenant_id` predicates.
- `services/openapi-sdk-service/src/sdk-package-repo.mjs` — data layer fix; `getSdkPackage`, `upsertSdkPackage`, `markStaleSdkPackages` gain `tenant_id` predicates.
- `GET /v1/workspaces/{workspaceId}/sdks/{language}/status` — now requires authentication (intentional breaking change for anonymous callers).
- `POST /v1/workspaces/{workspaceId}/sdks/generate` — cross-tenant spec read and row poisoning closed.
- `apps/web-console/src/lib/console-openapi-sdk.ts:66` — already supplies tenant headers; continues to work without changes.
