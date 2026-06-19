# Tasks — fix-executor-rbac-scope-role-enforcement

## Reproduce (test-first)
- [x] Added a failing black-box test (`tests/blackbox/executor-rbac-scope-role-enforcement.test.mjs`,
  bbx-624-01..07) driving `createControlPlaneServer` over HTTP:
  - a `data:read` API key writing (`POST .../documents`) → 403; running DDL → 403;
  - a non-admin role (`tenant_developer`) issuing keys → 403;
  - regression guards: a SERVICE key (full scopes) write → 201; an admin JWT with empty roles issuing
    keys → 201; a `data:read` key reading → 200.

## Implement
- [x] `apps/control-plane/src/runtime/server.mjs`:
  - added a `requiredDataScope(method, pathname)` resolver gating the privilege-escalating data-plane
    operations (writes → `data:write`, DDL → `ddl:write`; reads ungated — every key carries `data:read`);
  - enforce the required scope for API-key credentials (`identity.dbRole` present) in the request gate →
    `403 INSUFFICIENT_SCOPE`;
  - gate `/api-keys` management on an admin role (deny only when roles are known and non-admin);
  - parse `x-actor-roles` in `identityFromHeaders`.

## Verify
- [x] New black-box test passes (7/7); `bash tests/blackbox/run.sh` green (948/948), incl. no regression in
  executor-apikey-cross-tenant-idor, executor-credential-workspace-binding, gateway-authn-strip-tenant-headers,
  pg-insert-request-contract; unit/contracts/adapters green.
- [ ] Acceptance (real-stack on kind, `falcone-capability-tests/tests/rbac.mjs`): read-only key write/DDL
  denied; `tenant_developer` cannot issue keys; cross-tenant control still 403.

## Archive
- [ ] `openspec validate fix-executor-rbac-scope-role-enforcement --strict`; archive after merge.
