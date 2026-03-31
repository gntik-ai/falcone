# 103 Hard & Soft Quotas Data Model

- `plans.quota_type_config`: JSONB con `{dimensionKey -> {type, graceMargin}}`.
- `quota_overrides`: override por tenant+dimensión con justificación obligatoria, expiración opcional y estados `active|superseded|revoked|expired`.
- `quota_enforcement_log`: auditoría consultable de decisiones runtime.

Jerarquía efectiva: `override > plan > catalog default`.

Eventos Kafka:
- `console.quota.override.created`
- `console.quota.override.modified`
- `console.quota.override.revoked`
- `console.quota.override.expired`
- `console.quota.hard_limit.blocked`
- `console.quota.soft_limit.exceeded`
