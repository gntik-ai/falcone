# Tasks — fix-apisix-gateway-shared-secret-provisioning

## Implementation
- [x] Add a Secret template in the chart (`templates/gateway-shared-secret.yaml`) creating
  `in-falcone-gateway-shared-secret` (key `secret`). Value is generated once with
  `randAlphaNum 48` and re-read on every render via `lookup` (stable across upgrades —
  rotating it would desync gateway/executor); carries `helm.sh/resource-policy: keep`.
  Mirrors `seaweedfs-s3-creds.yaml`. Gated on `gatewaySharedSecret.create` (default true);
  set `create=false` and pre-create the secret to bring your own value.
- [x] Reference the secret in the APISIX deployment as `env.GATEWAY_SHARED_SECRET`
  (`apisix.env`, secretKeyRef → `in-falcone-gateway-shared-secret`/`secret`). Fixed literal
  name because the component-wrapper renders `env` via `toYaml`, not `tpl`.
- [x] Reference the same secret in the executor deployment (`controlPlaneExecutor.env`).
- [x] Verified the kind overlay (`deploy/kind/values-kind.yaml`) does NOT set `apisix.env`,
  so the base `apisix.env` (with GATEWAY_SHARED_SECRET) is not clobbered by the merge.

## Verification
- [x] Live kind cluster, isolated throwaway namespace, REAL standalone route table
  (`falcone-apisix-standalone`): an apisix pod with no env → `Error`, log "failed to read
  local yaml config of apisix: ... can't find environment variable GATEWAY_SHARED_SECRET"
  (the D3 crash, reproduced); the same pod with GATEWAY_SHARED_SECRET sourced from the
  chart Secret via secretKeyRef → `Running`, config loads clean.
- [x] Executor gateway-trust enforcement (request without valid x-gateway-auth → 401) is
  covered at the code level by `tests/blackbox/gateway-authn-strip-tenant-headers.test.mjs`;
  this change supplies the chart wiring so the executor receives the secret.
- [x] Black-box regression: `tests/blackbox/gateway-shared-secret-provisioning.test.mjs`
  (4 cases, helm-template-driven, self-skips without helm). Full suite: 644/644 pass.

## Archive
- [ ] `/opsx:archive fix-apisix-gateway-shared-secret-provisioning`
