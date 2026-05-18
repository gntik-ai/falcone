## 1. Failing tests

- [ ] 1.1 [test] Add `services/adapters/tests/kafka-executor.test.mjs`
      that calls `createTopicNamespace` against a KafkaJS in-process harness
      and asserts a topic with the prefixed name is created; today the test
      fails with `NOT_YET_IMPLEMENTED` (proves B10 Kafka part, G-S2.7).
- [ ] 1.2 [test] Add `services/adapters/tests/keycloak-executor.test.mjs`
      with one case per Keycloak stub (11 cases) that asserts the executor
      issues the expected admin-REST call; today all 11 fail with
      `NOT_YET_IMPLEMENTED` (proves B10 Keycloak part, G-S3.12).
- [ ] 1.3 [test] Add an audit-emission test asserting that a successful
      executor call emits the documented audit event
      (`kafka.admin.reconciled` for Kafka, `iam.admin.reconciled` for
      Keycloak) with the envelope shape already declared in the compiler
      layer.

## 2. Implementation

- [ ] 2.1 [impl] Add `services/adapters/src/runtime/kafka-client.mjs`
      implementing `createTopicNamespace` against KafkaJS with the timeout
      and retry profile in design Decision 5; map errors per Decision 4.
- [ ] 2.2 [impl] Replace the stub body at
      `services/adapters/src/kafka-admin.mjs:905-909` with a re-export of
      the runtime implementation; preserve the export name and signature
      (resolves B10 Kafka part).
- [ ] 2.3 [impl] Add `services/adapters/src/runtime/keycloak-client.mjs`
      implementing the 11 executor entry points (`createRealm`,
      `createClient`, `assignRole`, `createServiceAccount`,
      `updateServiceAccountScopeBindings`,
      `regenerateServiceAccountCredentials`, `disableServiceAccount`,
      `deleteServiceAccount`, `generateClientCredential`,
      `rotateClientCredential`, `revokeClientCredential`) against the
      Keycloak admin REST API with the profile in design Decision 5.
- [ ] 2.4 [impl] Replace the 11 stub bodies at
      `services/adapters/src/keycloak-admin.mjs:529-571` with re-exports of
      the runtime implementations; preserve names and signatures (resolves
      B10 Keycloak part).
- [ ] 2.5 [impl] Implement audit-event emission inside each executor;
      reuse the existing Kafka producer (per M2).
- [ ] 2.6 [migration] Add the feature flag
      `ADAPTER_EXECUTORS_ENABLED` and the helm-chart wiring for the
      Keycloak admin service-account credential.

## 3. Validation

- [ ] 3.1 [docs] Document the runtime split, the per-provider client
      choice, the feature-flag rollout, and the rollback path in
      `services/adapters/src/README.md`.
- [ ] 3.2 [test] Run the executor tests against the in-process harnesses;
      run `openspec validate complete-o1-executor-stubs --strict`; all
      green before merge.
