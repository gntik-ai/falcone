# Quickstart

1. Aplicar migraciones hasta `103-hard-soft-quota-overrides.sql`.
2. Ejecutar pruebas objetivo:
   - `node --test tests/integration/103-hard-soft-quota-overrides/*.test.mjs`
   - `node --test tests/contract/103-hard-soft-quota-overrides/*.test.mjs`
3. Variables nuevas:
   - `QUOTA_OVERRIDE_KAFKA_TOPIC_CREATED`
   - `QUOTA_OVERRIDE_KAFKA_TOPIC_MODIFIED`
   - `QUOTA_OVERRIDE_KAFKA_TOPIC_REVOKED`
   - `QUOTA_OVERRIDE_KAFKA_TOPIC_EXPIRED`
   - `QUOTA_ENFORCEMENT_KAFKA_TOPIC_HARD_BLOCKED`
   - `QUOTA_ENFORCEMENT_KAFKA_TOPIC_SOFT_EXCEEDED`
   - `QUOTA_OVERRIDE_EXPIRY_SWEEP_BATCH_SIZE`
   - `QUOTA_OVERRIDE_JUSTIFICATION_MAX_LENGTH`
