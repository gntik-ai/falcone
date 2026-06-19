# Tasks — fix-embedding-provider-gateway-route

## Reproduce (test-first)
- [x] Added a failing black-box test (`tests/blackbox/embedding-provider-get-roundtrip.test.mjs`):
  - `bbx-emb-get-01`: PUT then GET round-trip — GET returns the stored provider record with `secretRef`
    only; the plaintext key is not present in the response body.
  - `bbx-emb-get-02`: GET on a workspace with no provider configured returns `404 EMBEDDING_PROVIDER_NOT_FOUND`.
  - `bbx-emb-get-03`: `deploy/kind/apisix/apisix.yaml` declares route `2003-embedding` pointing to
    the executor, so `PUT/GET /v1/workspaces/{id}/embedding-provider` no longer falls through to the
    kind control-plane catch-all and returns `404 NO_ROUTE`.

## Implement
- [x] `deploy/kind/apisix/apisix.yaml`: added route `2003-embedding` (priority 337, `vars` regex
  `^/v1/workspaces/[^/]+/embedding-provider`) forwarding to `falcone-cp-executor`, mirroring
  `2003-keys` including `proxy-rewrite` that strips client identity headers and injects
  `x-gateway-auth: ${{GATEWAY_SHARED_SECRET}}` (#488 security model).
- [x] `apps/control-plane/src/runtime/server.mjs:403–404`: added `GET` handler wiring
  `runEmbeddingProvider(embeddingExecutor, 'get', { workspaceId: w, tenantId: c.identity.tenantId }, 200)`;
  `runEmbeddingProvider` at line 751–757 reads the store scoped by the verified identity's `tenantId`,
  returns the record (only `secretRef`, no plaintext key), or throws `404 EMBEDDING_PROVIDER_NOT_FOUND`
  when unset.

## Verify
- [x] New black-box tests pass (3/3); `bash tests/blackbox/run.sh` green (997/997), no regression in
  gateway-authn-strip-tenant-headers, executor-apikey-cross-tenant-idor, or executor-rbac-scope-role-enforcement.
- [ ] Acceptance (real-stack on kind): `PUT /v1/workspaces/{id}/embedding-provider` → 200; immediate
  `GET` → 200 with `secretRef` field present, no `apiKey`/`secret` field in body; GET on unconfigured
  workspace → 404; cross-tenant workspace id → 404 (tenant-scoped read returns nothing).

## Archive
- [ ] `openspec validate fix-embedding-provider-gateway-route --strict`; archive after merge.
