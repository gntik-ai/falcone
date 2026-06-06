## 1. Remove identity fallbacks

- [ ] 1.1 In `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity:15-22`, remove `?? params.tenantId` fallback from `tenantId` derivation
- [ ] 1.2 Remove `?? params.workspaceId` fallback from `workspaceId` derivation
- [ ] 1.3 Remove `?? params.actorId` fallback from `actorId` derivation (may default to `'system'` only when JWT sub is absent but JWT itself is valid)

## 2. Hard rejection guard

- [ ] 2.1 Add a guard in `parseIdentity` (or immediately after its call in `main:55-57`) that returns HTTP 401 / `UNAUTHENTICATED` when `params.jwt` is absent
- [ ] 2.2 Return HTTP 401 when `params.jwt.tenantId` is absent or empty
- [ ] 2.3 Return HTTP 401 when `params.jwt.workspaceId` is absent or empty

## 3. API gateway configuration

- [ ] 3.1 Verify that `deploy/apisix/routes/scheduling.yaml:10-14` `openid-connect` plugin is configured to inject verified claims into the action's `params.jwt` field
- [ ] 3.2 If claim-forwarding is absent, add the necessary APISIX plugin configuration

## 4. Verification

- [ ] 4.1 Add black-box test `bbx-sched-identity-fallback-01`: request with `tenantId`/`workspaceId` in body but no JWT returns HTTP 401
- [ ] 4.2 Add black-box test: JWT with missing `tenantId` claim returns HTTP 401
- [ ] 4.3 Add black-box test: authenticated request with valid JWT succeeds and returns only same-tenant resources
- [ ] 4.4 Run `bash tests/blackbox/run.sh`
