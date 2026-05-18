## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/openapi-sdk-service/tests/integration/sdk-generate.test.mjs`
      that calls `POST /v1/workspaces/{T_B-ws}/sdks` with
      `x-auth-tenant-id: T_A` and asserts the response is `403 FORBIDDEN`
      and no `workspace_sdk_packages` row is INSERTed with `T_A`, proving
      B2 at `sdk-generate.mjs:68`.
- [ ] 1.2 [test] Add a similar case for the status endpoint
      (`GET .../sdks/{lang}/status`) asserting cross-tenant reads receive
      `403 FORBIDDEN`, proving B4 at `sdk-generate.mjs:35`.
- [ ] 1.3 [test] Add a case for
      `openapi-spec-regenerate.main` invoked with no JWT and
      `workspaceBaseUrl: 'http://attacker.internal/admin'`; assert the
      response is `401 UNAUTHENTICATED` and no spec row is INSERTed,
      proving B9 at `openapi-spec-regenerate.mjs:10-15`.

## 2. Implementation

- [ ] 2.1 [impl] Add `assertWorkspaceOwnedByTenant(pool, workspaceId,
      tenantId)` helper in `services/openapi-sdk-service/src/` that runs
      `SELECT 1 FROM workspaces WHERE id = $1 AND tenant_id = $2`; throw
      `{statusCode: 403, code: 'FORBIDDEN'}` on miss.
- [ ] 2.2 [fix] Call the helper at the top of every handler in
      `sdk-generate.mjs` (POST at `:54-114`, GET at `:27-52`) and
      `openapi-spec-regenerate.mjs:10`.
- [ ] 2.3 [fix] Add a signed-context guard to
      `openapi-spec-regenerate.mjs:10`: require `params.jwt` with
      `scopes` containing `internal:openapi-regenerate`; reject otherwise
      with `401 UNAUTHENTICATED`.
- [ ] 2.4 [fix] Pipe `params.workspaceBaseUrl` through
      `normalizeServiceBaseUrl(value, { allowBareInternalHttp: false })`
      before passing to `assembleSpec` (`openapi-spec-regenerate.mjs:21`);
      reject invalid values with `400 INVALID_URL`.
- [ ] 2.5 [fix] In `sdk-generate.mjs:58` and `openapi-spec-serve.mjs:30`,
      reject requests carrying both `x-auth-tenant-id` and `x-tenant-id`
      with different values; return `400 HEADER_CONFLICT`.
- [ ] 2.6 [fix] URL-decode the path segment in `extractWorkspaceId`
      (`sdk-generate.mjs:12-14` and `openapi-spec-serve.mjs:10-13`) before
      regex match.

## 3. Validation

- [ ] 3.1 [docs] Document the tenant-ownership check, the regenerate
      service-account requirement, and the header rules in
      `services/openapi-sdk-service/README.md`.
- [ ] 3.2 [test] Re-run
      `corepack pnpm --filter openapi-sdk-service test`; green before merge.
