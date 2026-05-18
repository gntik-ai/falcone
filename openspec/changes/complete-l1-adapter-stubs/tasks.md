## 1. Failing tests

- [ ] 1.1 [test] Add an integration test in
      `services/backup-status/src/adapters/mongodb.adapter.test.ts`
      that points the adapter at a fake K8s API serving a
      `PerconaServerMongoDBBackup` with `status.completed`; assert
      `check()` returns `{ status: 'success', lastSuccessfulBackupAt:
      <expected> }`, not `not_available`.
- [ ] 1.2 [test] Add an integration test for `s3.adapter.test.ts`
      asserting bucket-versioning succeeds first; on miss, falls
      through to a sentinel object.
- [ ] 1.3 [test] Add an integration test for `kafka.adapter.test.ts`
      asserting MirrorMaker2 status is the primary signal.
- [ ] 1.4 [test] Add an integration test for `keycloak.adapter.test.ts`
      asserting the Velero VolumeSnapshot path succeeds first; on
      miss, falls through to the realm-export sentinel.
- [ ] 1.5 [test] Add a test for `shared/kafka-producer.test.ts`
      asserting `produceToKafka(...)` actually publishes (using an
      in-memory KafkaJS test producer) and never console-logs in
      production mode.

## 2. Implementation

- [ ] 2.1 [impl] Implement `mongodb.adapter.ts:30-36` per Design
      Decision 1 (Percona CRD → Velero → annotation).
- [ ] 2.2 [impl] Implement `s3.adapter.ts:30-36` per Design Decision 2
      (versioning → Velero → object tag).
- [ ] 2.3 [impl] Implement `kafka.adapter.ts:30-36` per Design
      Decision 3 (MirrorMaker2 → KafkaTopic annotation → topic
      sentinel).
- [ ] 2.4 [impl] Implement `keycloak.adapter.ts:30-36` per Design
      Decision 4 (Velero → realm-export sentinel).
- [ ] 2.5 [impl] Create `shared/kafka-producer.ts` and rewrite
      `shared/audit.ts:21-33` and `audit-trail.fallback.ts:39-45` to
      use it; delete the console-stub bodies.
- [ ] 2.6 [impl] Rewrite
      `shared/deployment-profile.ts:43-103:getManagedInstances` to
      call `DEPLOYMENT_PROFILE_API_URL`; keep stub as dev-only
      fallback per Design Decision 6.

## 3. Validation

- [ ] 3.1 [test] Re-run `pnpm test`, `pnpm typecheck`, `pnpm lint`,
      and `openspec validate complete-l1-adapter-stubs --strict`;
      all green.
- [ ] 3.2 [docs] Document the per-adapter strategy chains and the
      `DEPLOYMENT_PROFILE_API_URL` requirement in
      `services/backup-status/README.md`.
