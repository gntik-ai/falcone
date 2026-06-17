# Tasks — fix-apisix-gateway-shared-secret-provisioning

## Implementation
- [ ] Add a Secret template in the chart (`in-falcone-gateway-shared-secret`) that
  generates a random 32-byte hex value at install if not overridden via `existingSecret`.
- [ ] Mount / reference the secret in the APISIX deployment template as
  `env.GATEWAY_SHARED_SECRET`.
- [ ] Mount / reference the same secret in the executor deployment template.
- [ ] Ensure the kind `values-kind.yaml` (or equivalent) does not override with an
  empty value.

## Verification
- [ ] `helm install` on kind → APISIX reaches `Running` on first attempt.
- [ ] Executor enforces gateway trust: request without valid signature → 401/403.
- [ ] Run `/opsx:verify fix-apisix-gateway-shared-secret-provisioning`.

## Archive
- [ ] `/opsx:archive fix-apisix-gateway-shared-secret-provisioning`
