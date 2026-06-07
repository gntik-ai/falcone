## 1. PG CDC bridge topic fix

- [ ] 1.1 Rewrite `services/pg-cdc-bridge/src/KafkaChangePublisher.mjs:10`: replace the env-var-as-complete-topic logic with a validated namespace prefix; produce topic `${namespace}.${tenant_id}.${workspace_id}.pg-changes` when override is set, or `${tenant_id}.${workspace_id}.pg-changes` when unset
- [ ] 1.2 Add startup validation of `PG_CDC_KAFKA_TOPIC_PREFIX` against `^[a-z][a-z0-9._-]{0,63}$`; exit fatally on invalid value

## 2. Mongo CDC bridge topic fix

- [ ] 2.1 Rewrite `services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs::resolveTopic:5`: same namespace-prefix-only logic as item 1.1; produce `${namespace}.${tenant_id}.${workspace_id}.mongo-changes` when override is set
- [ ] 2.2 Add startup validation of `MONGO_CDC_KAFKA_TOPIC_PREFIX` against the same pattern; exit fatally on invalid value

## 3. Capture config cache hardening

- [ ] 3.1 Add `tenant_id` predicate to the SQL query in `services/pg-cdc-bridge/src/CaptureConfigCache.mjs:8` so the cache loads only configs for the operating tenant
- [ ] 3.2 Add tenant or data-source scoping to `services/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs:19` so the poll does not return configs for all tenants

## 4. Verification

- [ ] 4.1 Add black-box test: with `PG_CDC_KAFKA_TOPIC_PREFIX=testns`, events for tenant `tenant-a` publish to `testns.tenant-a.<ws>.pg-changes` and events for tenant `tenant-b` publish to `testns.tenant-b.<ws>.pg-changes` (cross-tenant topic separation confirmed)
- [ ] 4.2 Add black-box test: invalid override value (e.g., `UPPER`) causes PG bridge startup failure
- [ ] 4.3 Add black-box test: invalid override value causes Mongo bridge startup failure
- [ ] 4.4 Run `bash tests/blackbox/run.sh`
