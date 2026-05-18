## 1. Failing tests

- [ ] 1.1 [test] Add a test under `services/adapters/tests/` that supplies
      principal `User:svc_alpha_dev_ATTACKER_suffix` against the policy
      prefix `User:svc_alpha_dev_` and asserts validation rejects it; today
      the `startsWith` check passes (proves B2, G-S2.4).
- [ ] 1.2 [test] Add a test that calls every per-kind branch of
      `keycloak-admin.mjs` with `context: {realmId: undefined}` and
      `payload: {realm: undefined}` and asserts a
      `GW_ADAPTER_REALM_MISSING` violation; today the resource normalises
      with `realmId: undefined` (proves B7, G-S3.8).
- [ ] 1.3 [test] Add a test that creates two workspaces with namespaces
      `ws-a` and `ws-a-backup`, then attempts to register a client
      `ws-a-backup-client` under workspace `ws-a` and asserts the validation
      rejects it; today both namespaces match the `startsWith` prefix
      (proves B14, G-S3.9).

## 2. Implementation

- [ ] 2.1 [fix] Replace `principal.startsWith(prefix)` at
      `services/adapters/src/kafka-admin.mjs:419` with a strict-grammar
      check that the principal is `${prefix}${alphanumDash}` and contains no
      additional `_`-delimited segments (resolves B2, G-S2.4).
- [ ] 2.2 [fix] Replace every `realmId: context.realmId ?? payload.realm`
      site at `services/adapters/src/keycloak-admin.mjs:184, :210, :221,
      :236` with a context-only read; emit
      `GW_ADAPTER_REALM_MISSING` when context lacks `realmId` (resolves
      B7, G-S3.8).
- [ ] 2.3 [fix] Replace `clientId.startsWith(workspaceClientNamespace)` at
      `services/adapters/src/keycloak-admin.mjs:374` with an
      exact-segment match: clientId MUST be
      `${namespace}_${alphanumDashSegment}` with no further namespace
      separators (resolves B14, G-S3.9).

## 3. Validation

- [ ] 3.1 [docs] Document the new grammar for principal, clientId, and the
      context-only realmId rule in `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run the three new tests; run
      `openspec validate fix-o1-acl-prefix-and-realm-fallback --strict`; all
      green before merge.
