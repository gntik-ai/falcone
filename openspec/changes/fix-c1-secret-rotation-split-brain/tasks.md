## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/actions/secret-rotation-split-brain.test.mjs` proving (a) `secret-rotation-initiate` with simulated DB commit failure does not leave a vault version (B5.1), (b) `secret-rotation-expiry-sweep` with simulated vault-delete failure leaves the DB row in `expiring` and the vault entry intact for retry (B5.2), (c) no concurrent reader ever observes `vault_version=-1` (B5.3), (d) `ensureNoSecretMaterial` rejects `secret_value`, `api_key`, `client_secret` (B5.4), and (e) each of the three Kafka recorders does NOT commit offsets after a simulated DB insert failure (B5.5).

## 2. Implementation

- [ ] 2.1 [migration] Add migration that makes `secret_versions.vault_version` NULLABLE and constrains `state` to the documented enum if not already constrained.
- [ ] 2.2 [fix] Rewrite `services/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs:50,79,81,87`: insert DB row with `vault_version=NULL,state='pending'`, write vault, then transactionally `UPDATE` to `vault_version=real_id,state='active'`; on vault failure delete the pending row in a clean compensating txn.
- [ ] 2.3 [fix] Rewrite `services/provisioning-orchestrator/src/actions/secret-rotation-expiry-sweep.mjs:24`: transition to `expiring` in txn 1, vault delete, transition to `expired` in txn 2; vault failure leaves the row in `expiring` for the next sweep.
- [ ] 2.4 [fix] Replace `ensureNoSecretMaterial` in `services/provisioning-orchestrator/src/models/secret-version-state.mjs:7,33` with an explicit denylist + allow-only-typed-fields schema check matching `*_value|*_secret|*_token|*_password|*_key` after normalisation.
- [ ] 2.5 [fix] In `privilege-domain-event-recorder.mjs`, `function-privilege-denial-recorder.mjs`, `scope-enforcement-event-recorder.mjs` (~`:39-50` each), only `commitOffsets` after the DB insert succeeds; on failure log + re-throw so the consumer retries.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/actions/secret-rotation-split-brain.test.mjs` and `openspec validate fix-c1-secret-rotation-split-brain --strict`; both green before merge.
