## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `services/mongo-cdc-bridge/tests/unit/env-precedence.test.mjs`
      that sets `NODE_ENV='production'` plus both `MONGO_TEST_URI` and
      `MONGO_URI`; assert the factory connects to `MONGO_URI` (not the
      test URI) — fails today (test URI wins).
- [ ] 1.2 [test] Add a case under `NODE_ENV='test'` where only
      `MONGO_TEST_URI` is set; assert the factory connects to it AND a
      startup `WARN` log is emitted.
- [ ] 1.3 [test] Add a topic-isolation test that sets
      `MONGO_CDC_KAFKA_TOPIC_PREFIX="foo"` and publishes for two distinct
      `(tenant, workspace)` pairs; assert the topics are
      `foo.<t1>.<w1>.mongo-changes` and `foo.<t2>.<w2>.mongo-changes`,
      not both `foo`.
- [ ] 1.4 [test] Add a case setting `MONGO_CDC_KAFKA_TOPIC_OVERRIDE="dlq"`
      and asserting both publishes land on `dlq` AND a startup WARN log
      is emitted.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite the `mongoClientFactory` URI resolution in
      `services/mongo-cdc-bridge/src/index.mjs:27` to:
      `const uri = config.mongo_uri ?? process.env.MONGO_URI ??
      (process.env.NODE_ENV === 'test' ? process.env.MONGO_TEST_URI :
      undefined); if (!uri) throw new Error('MONGO_URI_REQUIRED');`
      and log a startup WARN when the test URI is used.
- [ ] 2.2 [fix] In
      `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs:5`, replace
      `resolveTopic` with: `prefix = process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX;
      override = process.env.MONGO_CDC_KAFKA_TOPIC_OVERRIDE; return
      override ?? (prefix ? \`${prefix}.${tenant}.${workspace}.mongo-changes\`
      : \`${tenant}.${workspace}.mongo-changes\`)`. Warn at boot when
      `_OVERRIDE` is set.
- [ ] 2.3 [migration] Update `helm/mongo-cdc-bridge/values.yaml` to surface
      the two env vars; document migration from the old single-value
      `_PREFIX` semantics.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the env precedence rules and the new topic
      naming contract in `services/mongo-cdc-bridge/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:unit` and `openspec validate
      fix-e2-env-and-topic-isolation --strict`; both green before merge.
