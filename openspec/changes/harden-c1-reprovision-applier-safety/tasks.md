## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/appliers/applier-safety.test.mjs` proving (a) `identifier-map.applyMapping` rejects a map with cyclic substring overlap (`{"abc"->"abcd"}`) and enforces a per-call output cap (B4.4), (b) `iam-applier` issues exactly one token fetch across a sequence of `kcApi()` calls within the token TTL (B4.5), (c) `safe-url` rejects a bare internal HTTP URL whose host is not in the configured allow-list (B4.6), and (d) `postgres-applier._ident` rejects identifiers containing `\n`, `\0`, or `\r` (B4.7).

## 2. Implementation

- [ ] 2.1 [fix] In `services/provisioning-orchestrator/src/lib/identifier-map.mjs:216-250`, add a max-1-pass rule, cycle detection (reject if any output still contains an unmapped key prefix that would expand on re-application), and a per-call output-length cap (e.g., 4x input length).
- [ ] 2.2 [fix] In `services/provisioning-orchestrator/src/appliers/iam-applier.mjs:40-65`, cache the admin token keyed on `(keycloakUrl, realm, clientId)` with `expires_in - 30s` TTL; reuse cached value across `kcApi()` calls.
- [ ] 2.3 [fix] In `services/provisioning-orchestrator/src/http/safe-url.mjs:41-44`, require an explicit allow-list (env-configured, default empty) for `allowBareInternalHttp`; update `services/provisioning-orchestrator/src/appliers/iam-applier.mjs:40-51` to resolve `keycloakUrl` against that list.
- [ ] 2.4 [fix] In `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs:156-159`, extend `_ident` to reject identifiers matching `/[\x00-\x1f]/`.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/appliers/applier-safety.test.mjs` and `openspec validate harden-c1-reprovision-applier-safety --strict`; both green before merge.
