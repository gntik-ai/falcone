## 1. Authentication gate

- [ ] 1.1 Add service-identity authentication extraction to `services/provisioning-orchestrator/src/actions/secret-consumer-ack.mjs` (mTLS cert or short-lived service token)
- [ ] 1.2 Implement `allowed()` gate that returns HTTP 401 when no valid credential is present, before any DB call
- [ ] 1.3 Treat `consumerId`, `secretPath`, `vaultVersion` as untrusted input; derive `actorId` from the authenticated principal only

## 2. Registry membership and tenant consistency

- [ ] 2.1 Call `listConsumers` (`services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs:102-104`) to verify `(secretPath, consumerId)` exists in `secret_consumer_registry`; return HTTP 403 if not found
- [ ] 2.2 Call `getVersionByVaultVersion` to resolve `secret_version_states.tenant_id` for `(secretPath, vaultVersion)` and assert it matches the registered consumer's tenant; return HTTP 403 on mismatch
- [ ] 2.3 Ensure no `confirmPropagation` or `insertRotationEvent` call is made on any 401 or 403 path

## 3. Audit identity binding

- [ ] 3.1 In `services/provisioning-orchestrator/src/repositories/secret-rotation-repo.mjs::insertRotationEvent:65-76`, ensure `actor_id` is set from the authenticated service principal, not from the caller-supplied `consumerId`

## 4. Verification

- [ ] 4.1 Add black-box test `bbx-sec-ack-unauth-01`: unauthenticated ack returns HTTP 401
- [ ] 4.2 Add black-box test `bbx-sec-ack-unregistered-01`: authenticated caller with unregistered `consumerId` returns HTTP 403
- [ ] 4.3 Add black-box test: legitimate registered consumer with valid service identity succeeds
- [ ] 4.4 Run `bash tests/blackbox/run.sh`
