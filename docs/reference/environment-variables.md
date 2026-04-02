# Referencia de variables de entorno operativas

Esta referencia documenta solo variables de runtime / despliegue que afectan al comportamiento real de la plataforma. Se excluyen variables de pruebas y scaffolding local salvo que tengan uso operativo claro.

## Leyenda

- **Obligatorio**: sí / condicional / no
- **Por defecto**: valor aplicado si la variable no se define
- **Secreto**: indica si el valor debe tratarse como sensible

## 1. Bootstrap del chart y arranque one-shot

| Variable | Componente | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|------------|-----------|-------------|------------|---------|-------|
| `BOOTSTRAP_KEYCLOAK_ADMIN_USERNAME` | Bootstrap Helm | Usuario admin de Keycloak usado por el job de bootstrap para obtener token de gestión | Condicional | — | Sí | Requerido junto con la contraseña |
| `BOOTSTRAP_KEYCLOAK_ADMIN_PASSWORD` | Bootstrap Helm | Contraseña del admin de Keycloak para el token inicial | Condicional | — | Sí | Nunca en texto plano en Git |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | Bootstrap Helm | Password inicial del usuario superadmin del realm | Sí | — | Sí | Necesario para terminar el bootstrap |
| `BOOTSTRAP_APISIX_ADMIN_KEY` | Bootstrap Helm | Clave de administración de APISIX usada por el script de reconciliación | Sí | — | Sí | Se consume durante la fase de reconcile |

## 2. `services/provisioning-orchestrator`

### 2.1 Exportación de configuración y conectores de dominio

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `CONFIG_EXPORT_DEPLOYMENT_PROFILE` | Perfil de despliegue que condiciona el registry de collectors | No | `standard` | No | Controla qué dominios se consideran disponibles |
| `CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS` | Timeout por collector durante exportación | No | `8000` | No | Se aplica por dominio |
| `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` | Tamaño máximo del artefacto exportado | No | `10485760` | No | 10 MB |
| `CONFIG_EXPORT_OW_ENABLED` | Activa el collector de OpenWhisk | No | `false` | No | Si es `true`, exigen credenciales y host |
| `CONFIG_EXPORT_OW_API_HOST` | Host/base URL de OpenWhisk | Condicional | — | No | Requerido si `CONFIG_EXPORT_OW_ENABLED=true` |
| `CONFIG_EXPORT_OW_AUTH_TOKEN` | Token para OpenWhisk | Condicional | — | Sí | Requerido si `CONFIG_EXPORT_OW_ENABLED=true` |
| `CONFIG_EXPORT_MONGO_ENABLED` | Activa el collector de MongoDB | No | `false` | No | |
| `CONFIG_EXPORT_MONGO_URI` | URI de MongoDB para exportación | Condicional | — | Sí | Requerido si `CONFIG_EXPORT_MONGO_ENABLED=true` |
| `CONFIG_EXPORT_MONGO_DB_PREFIX` | Prefijo de base de datos para Mongo export | No | `""` | No | Opcional |
| `CONFIG_EXPORT_PG_DATABASE_URL` | DSN PostgreSQL para exportación | Condicional | — | Sí | Requerido por el collector PostgreSQL |
| `CONFIG_EXPORT_PG_SCHEMA_PREFIX` | Prefijo de esquema en PostgreSQL | No | `""` | No | Opcional |
| `CONFIG_EXPORT_KAFKA_BROKERS` | Brokers Kafka para exportar metadatos de Kafka | Condicional | — | No | Requerido si se habilita el collector Kafka |
| `CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME` | Usuario SASL admin para Kafka | No | — | Sí | Opcional, si el broker exige SASL |
| `CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD` | Password SASL admin para Kafka | No | — | Sí | Opcional, sensible |
| `CONFIG_EXPORT_S3_ENDPOINT` | Endpoint S3-compatible | Condicional | — | No | Requerido para el collector S3 |
| `CONFIG_EXPORT_S3_ACCESS_KEY_ID` | Access key de S3 | Condicional | — | Sí | Requerido para el collector S3 |
| `CONFIG_EXPORT_S3_SECRET_ACCESS_KEY` | Secret key de S3 | Condicional | — | Sí | Requerido para el collector S3 |
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_URL` | URL de administración de Keycloak | Condicional | — | No | Requerido para el collector IAM |
| `CONFIG_EXPORT_KEYCLOAK_CLIENT_ID` | Client ID para Keycloak admin | Condicional | — | No | Requerido para el collector IAM |
| `CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET` | Client secret para Keycloak admin | Condicional | — | Sí | Requerido para el collector IAM |
| `CONFIG_EXPORT_KEYCLOAK_URL` | URL base de Keycloak usada por el analizador IAM | Condicional | — | No | Se usa en preflight/análisis |
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_CLIENT_ID` | Client ID admin para análisis IAM | Condicional | — | No | Se usa en preflight/análisis |
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_SECRET` | Client secret admin para análisis IAM | Condicional | — | Sí | Se usa en preflight/análisis |
| `CONFIG_EXPORT_KAFKA_TOPIC_COMPLETED` | Topic Kafka de export completada | No | `console.config.export.completed` | No | |

### 2.2 Validación, migración y preflight de artefactos

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `CONFIG_SCHEMA_MAX_INPUT_BYTES` | Límite de tamaño del artefacto para validate/migrate | No | `10485760` | No | 10 MB |
| `CONFIG_SCHEMA_KAFKA_TOPIC_VALIDATED` | Topic de auditoría de validación | No | `console.config.schema.validated` | No | |
| `CONFIG_SCHEMA_KAFKA_TOPIC_MIGRATED` | Topic de auditoría de migración | No | `console.config.schema.migrated` | No | |
| `CONFIG_PREFLIGHT_SUPPORTED_FORMAT_MAJOR` | Major de formato soportado por preflight | No | `1` | No | |
| `CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS` | Timeout por analizador en preflight | No | `10000` | No | |
| `CONFIG_PREFLIGHT_OW_ENABLED` | Habilita análisis de OpenWhisk en preflight | No | `false` | No | |
| `CONFIG_PREFLIGHT_MONGO_ENABLED` | Habilita análisis de MongoDB en preflight | No | `false` | No | |
| `CONFIG_PREFLIGHT_KAFKA_TOPIC` | Topic Kafka de preflight | No | `console.config.reprovision.preflight` | No | |
| `CONFIG_IMPORT_SUPPORTED_FORMAT_MAJOR` | Major de formato soportado por reprovision/import | No | `1` | No | |
| `CONFIG_IMPORT_APPLIER_TIMEOUT_MS` | Timeout por applier durante reprovision | No | `10000` | No | |
| `CONFIG_IMPORT_LOCK_TTL_MS` | TTL del lock de reprovision | No | `120000` | No | 120 s |
| `CONFIG_IMPORT_DEPLOYMENT_PROFILE` | Perfil de despliegue durante reprovision | No | `standard` | No | |
| `CONFIG_IMPORT_OW_ENABLED` | Habilita appliers de OpenWhisk | No | `false` | No | |
| `CONFIG_IMPORT_OW_API_HOST` | Host/base URL de OpenWhisk para reprovision | Condicional | — | No | Requerido si `CONFIG_IMPORT_OW_ENABLED=true` |
| `CONFIG_IMPORT_OW_AUTH_TOKEN` | Token de OpenWhisk para reprovision | Condicional | — | Sí | Requerido si `CONFIG_IMPORT_OW_ENABLED=true` |
| `CONFIG_IMPORT_KAFKA_TOPIC_COMPLETED` | Topic Kafka de reprovision completado | No | `console.config.reprovision.completed` | No | Usado por el flujo de import/reprovision |
| `CONFIG_IMPORT_KAFKA_TOPIC_MAP` | Topic Kafka del identifier map generado | No | `console.config.reprovision.identifier-map` | No | Usado por el flujo de import/reprovision |
| `CONFIG_REPROVISION_KAFKA_TOPIC_COMPLETED` | Topic Kafka de reprovision completado | No | `console.config.reprovision.completed` | No | Usado por el publisher de eventos de reprovision |
| `CONFIG_REPROVISION_KAFKA_TOPIC_MAP` | Topic Kafka del identifier map generado | No | `console.config.reprovision.identifier-map` | No | Usado por el publisher de eventos de reprovision |

### 2.3 Cuotas, planes, capacidades y privilegios

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `PLAN_KAFKA_TOPIC_CREATED` | Topic de `plan.created` | No | `console.plan.created` | No | |
| `PLAN_KAFKA_TOPIC_UPDATED` | Topic de `plan.updated` | No | `console.plan.updated` | No | |
| `PLAN_KAFKA_TOPIC_LIFECYCLE` | Topic de `plan.lifecycle_transitioned` | No | `console.plan.lifecycle_transitioned` | No | |
| `PLAN_KAFKA_TOPIC_ASSIGNMENT_CREATED` | Topic de `assignment.created` | No | `console.plan.assignment.created` | No | |
| `PLAN_KAFKA_TOPIC_ASSIGNMENT_SUPERSEDED` | Topic de `assignment.superseded` | No | `console.plan.assignment.superseded` | No | |
| `PLAN_LIMITS_KAFKA_TOPIC_UPDATED` | Topic de cambios de límite por dimensión | No | `console.plan.limit_updated` | No | |
| `CAPABILITY_KAFKA_TOPIC_ENABLED` | Topic para capacidades activadas | No | `console.plan.capability.enabled` | No | |
| `CAPABILITY_KAFKA_TOPIC_DISABLED` | Topic para capacidades desactivadas | No | `console.plan.capability.disabled` | No | |
| `QUOTA_OVERRIDE_KAFKA_TOPIC_CREATED` | Topic para overrides de cuota creados | No | `console.quota.override.created` | No | |
| `QUOTA_OVERRIDE_KAFKA_TOPIC_MODIFIED` | Topic para overrides de cuota modificados | No | `console.quota.override.modified` | No | |
| `QUOTA_OVERRIDE_KAFKA_TOPIC_REVOKED` | Topic para overrides de cuota revocados | No | `console.quota.override.revoked` | No | |
| `QUOTA_OVERRIDE_KAFKA_TOPIC_EXPIRED` | Topic para overrides de cuota expirados | No | `console.quota.override.expired` | No | |
| `QUOTA_ENFORCEMENT_KAFKA_TOPIC_HARD_BLOCKED` | Topic para bloqueos duros de cuota | No | `console.quota.hard_limit.blocked` | No | |
| `QUOTA_ENFORCEMENT_KAFKA_TOPIC_SOFT_EXCEEDED` | Topic para excedencias de cuota suave | No | `console.quota.soft_limit.exceeded` | No | |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_SCOPE_DENIED` | Topic para denegación de scope insuficiente | No | `console.security.scope-denied` | No | |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_PLAN_DENIED` | Topic para denegación por entitlement de plan | No | `console.security.plan-denied` | No | |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_WORKSPACE_MISMATCH` | Topic para mismatch de workspace | No | `console.security.workspace-mismatch` | No | |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_CONFIG_ERROR` | Topic para errores de configuración | No | `console.security.config-error` | No | |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_DENIED` | Topic para denegaciones de privilege-domain | No | `console.security.privilege-domain-denied` | No | |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_ASSIGNED` | Topic para asignaciones de privilege-domain | No | `console.security.privilege-domain-assigned` | No | |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_REVOKED` | Topic para revocaciones de privilege-domain | No | `console.security.privilege-domain-revoked` | No | |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_LAST_ADMIN` | Topic del guard de último admin | No | `console.security.last-admin-guard-triggered` | No | |
| `BACKUP_SCOPE_KAFKA_TOPIC_QUERIED` | Topic para consultas de backup scope | No | `console.backup.scope.queried` | No | |
| `PG_CAPTURE_KAFKA_TOPIC_LIFECYCLE` | Topic de ciclo de vida de captura PostgreSQL | No | `console.pg-capture.lifecycle` | No | |
| `MONGO_CAPTURE_KAFKA_TOPIC_LIFECYCLE` | Topic de ciclo de vida de captura MongoDB | No | `console.mongo-capture.lifecycle` | No | |
| `REALTIME_SUBSCRIPTION_KAFKA_TOPIC` | Topic de ciclo de vida de suscripciones realtime | No | `console.realtime.subscription-lifecycle` | No | |

### 2.4 Rotación de secretos

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `SECRET_ROTATION_MIN_GRACE_SECONDS` | Mínimo de gracia permitido para rotación | No | `300` | No | 5 min |
| `SECRET_ROTATION_MAX_GRACE_SECONDS` | Máximo de gracia permitido para rotación | No | `86400` | No | 24 h |
| `SECRET_ROTATION_DEFAULT_GRACE_SECONDS` | Gracia por defecto en rotación | No | `1800` | No | 30 min |
| `SECRET_ROTATION_SWEEP_BATCH_SIZE` | Tamaño de lote del sweep de expiración | No | `50` | No | |
| `RELOAD_ACK_TIMEOUT_SECONDS` | Tiempo máximo de confirmación de recarga | No | `60` | No | Usado por el sweep de propagation timeout |

## 3. `services/realtime-gateway`

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `KEYCLOAK_JWKS_URL` | URL JWKS para validar JWT | Sí | — | No | URL válida requerida |
| `KEYCLOAK_INTROSPECTION_URL` | Endpoint de introspección | Sí | — | No | URL válida requerida |
| `KEYCLOAK_INTROSPECTION_CLIENT_ID` | Client ID para introspección | Sí | — | No | |
| `KEYCLOAK_INTROSPECTION_CLIENT_SECRET` | Client secret para introspección | Sí | — | Sí | Secreto sensible |
| `DATABASE_URL` | DSN de base de datos | Sí | — | Sí | Requerido para runtime |
| `KAFKA_BROKERS` | Lista de brokers Kafka separada por comas | Sí | — | No | Debe contener al menos un broker |
| `JWKS_CACHE_TTL_SECONDS` | TTL de caché JWKS | No | `300` | No | |
| `SCOPE_REVALIDATION_INTERVAL_SECONDS` | Intervalo de revalidación de scopes | No | `30` | No | |
| `TOKEN_EXPIRY_GRACE_SECONDS` | Gracia para expiración de token | No | `30` | No | |
| `MAX_FILTER_PREDICATES` | Máximo de predicados de filtrado | No | `10` | No | |
| `MAX_SUBSCRIPTIONS_PER_WORKSPACE` | Máximo de suscripciones por workspace | No | `50` | No | |
| `AUDIT_KAFKA_TOPIC_AUTH_GRANTED` | Topic de auth concedida | No | `console.realtime.auth-granted` | No | |
| `AUDIT_KAFKA_TOPIC_AUTH_DENIED` | Topic de auth denegada | No | `console.realtime.auth-denied` | No | |
| `AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED` | Topic de sesión suspendida | No | `console.realtime.session-suspended` | No | |
| `AUDIT_KAFKA_TOPIC_SESSION_RESUMED` | Topic de sesión reanudada | No | `console.realtime.session-resumed` | No | |
| `REALTIME_AUTH_ENABLED` | Activa o desactiva la capa de auth realtime | No | `true` | No | Debe ser `true` o `false` |

## 4. `services/openapi-sdk-service`

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `DATABASE_URL` | DSN PostgreSQL | Sí en producción | — | Sí | Requerido cuando `NODE_ENV=production` |
| `KAFKA_BROKERS` | Brokers Kafka | Sí en producción | — | No | Requerido cuando `NODE_ENV=production` |
| `KAFKA_CLIENT_ID` | Client ID para Kafka | No | `openapi-sdk-service` | No | |
| `S3_ENDPOINT` | Endpoint S3-compatible | Sí en producción | — | No | Requerido cuando `NODE_ENV=production` |
| `S3_SDK_BUCKET` | Bucket para SDKs | No | `workspace-sdks` | No | |
| `S3_ACCESS_KEY` | Access key S3 | Sí en producción | — | Sí | Requerido cuando `NODE_ENV=production` |
| `S3_SECRET_KEY` | Secret key S3 | Sí en producción | — | Sí | Requerido cuando `NODE_ENV=production` |
| `S3_PRESIGNED_URL_TTL_SECONDS` | TTL de URLs presignadas | No | `86400` | No | 24 h |
| `EFFECTIVE_CAPABILITIES_BASE_URL` | Base URL del servicio de capacidades efectivas | Sí en producción | — | No | Requerido cuando `NODE_ENV=production` |
| `SPEC_RATE_LIMIT_PER_MINUTE` | Límite de rate por minuto para generación / consulta | No | `60` | No | |
| `SDK_RETENTION_DAYS` | Retención de SDKs | No | `90` | No | |
| `NODE_ENV` | Modo de ejecución | No | `development` | No | Controla la validación de obligatorios |

## 5. `services/workspace-docs-service`

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `WORKSPACE_DOCS_DB_URL` | DSN de la base de datos del servicio | Sí en producción | `""` | Sí | Debe configurarse para uso real |
| `KAFKA_BROKERS` | Brokers Kafka | Sí en producción | `""` | No | Necesario para publicación de eventos |
| `INTERNAL_API_BASE_URL` | Base URL de APIs internas | Sí en producción | `""` | No | Usado por integraciones internas |
| `WORKSPACE_DOCS_NOTE_MAX_LENGTH` | Longitud máxima de notas | No | `4096` | No | Debe ser entero positivo |

## 6. `apps/control-plane` / saga

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `SAGA_COMPENSATION_MAX_RETRIES` | Reintentos máximos de compensación | No | `3` | No | |
| `SAGA_COMPENSATION_BASE_DELAY_MS` | Retardo base entre reintentos | No | `500` | No | |
| `SAGA_COMPENSATION_MAX_DELAY_MS` | Retardo máximo entre reintentos | No | `10000` | No | |
| `SAGA_RECOVERY_STALENESS_MS` | Umbral de obsolescencia para recuperación | No | `60000` | No | |

## 7. `services/backup-status`

### 7.1 Conectividad, identidad y contexto de despliegue

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `DB_URL` | DSN PostgreSQL usado por el servicio | Sí | — | Sí | Requerido por los repositorios de backup-status |
| `KAFKA_BROKERS` | Brokers Kafka | Condicional | — | No | Requerido para publicar auditoría / dispatcher |
| `KEYCLOAK_JWKS_URL` | JWKS para validar autenticación | Sí | — | No | Sin esto, la API no puede autenticar usuarios |
| `DEPLOYMENT_PROFILE_API_URL` | API para resolver perfil de despliegue | No | — | No | Opcional, si existe resolución remota |
| `DEPLOYMENT_PROFILE_SLUG` | Slug del perfil activo | No | `default` | No | |
| `K8S_SERVICE_ACCOUNT_TOKEN` | Token para llamadas a Kubernetes | Condicional | — | Sí | Necesario para collector / restore / dispatcher |
| `K8S_NAMESPACE` | Namespace objetivo | No | `default` | No | |
| `KEYCLOAK_OTP_VERIFY_URL` | Endpoint de verificación OTP | No | `""` | No | Usado por prechecks / confirmaciones |

### 7.2 Backups, collectors y restauración

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `BACKUP_ENABLED` | Activa o desactiva el flujo principal de backup | No | `true` | No | Se desactiva con `false` |
| `BACKUP_COLLECTOR_INTERVAL_MS` | Intervalo de recolección | No | `300000` | No | 5 min |
| `BACKUP_ADAPTER_TIMEOUT_MS` | Timeout de adaptadores | No | `10000` | No | |
| `BACKUP_STALE_THRESHOLD_MINUTES` | Umbral de backup obsoleto | No | `15` | No | |
| `BACKUP_STALE_THRESHOLD_MS` | Umbral equivalente en ms | No | `900000` | No | |
| `BACKUP_STALENESS_HOURS` | Antigüedad máxima de snapshots | No | `25` | No | |
| `BACKUP_ADAPTER_S3_ENABLED` | Habilita adaptador S3 | No | `false` | No | |
| `BACKUP_ADAPTER_KEYCLOAK_ENABLED` | Habilita adaptador Keycloak | No | `false` | No | |
| `BACKUP_ADAPTER_KAFKA_ENABLED` | Habilita adaptador Kafka | No | `false` | No | |
| `BACKUP_ADAPTER_MONGODB_ENABLED` | Habilita adaptador MongoDB | No | `false` | No | |
| `EXPIRY_JOB_ENABLED` | Activa el job de expiración | No | `true` | No | Se desactiva con `false` |
| `CONFIRMATION_TTL_SECONDS` | TTL para confirmaciones | No | `300` | No | |
| `PRECHECK_TIMEOUT_MS` | Timeout de prechecks | No | `10000` | No | |
| `PRECHECK_SNAPSHOT_AGE_WARNING_HOURS` | Umbral de advertencia por antigüedad | No | `48` | No | |
| `CRITICAL_RISK_MULTI_WARNING_THRESHOLD` | Umbral de riesgo crítico por acumulación de warnings | No | `3` | No | |
| `PRECHECK_OPERATIONAL_HOURS_ENABLED` | Activa la ventana operativa | No | `true` | No | Se desactiva con `false` |
| `PRECHECK_OPERATIONAL_HOURS_START` | Hora de inicio de la ventana operativa | No | `08:00` | No | Formato HH:MM |
| `PRECHECK_OPERATIONAL_HOURS_END` | Hora de fin de la ventana operativa | No | `20:00` | No | Formato HH:MM |
| `MFA_ENABLED` | Exige MFA en confirmaciones / acciones sensibles | No | `true` | No | Se desactiva con `false` |
| `RESTORE_CONFIRMATION_ENABLED` | Requiere confirmación explícita antes de restaurar | No | `true` | No | Se desactiva con `false` |
| `MAX_PUBLISH_ATTEMPTS` | Reintentos máximos de publicación de auditoría | No | `5` | No | |
| `AUDIT_MAX_RANGE_DAYS` | Ventana máxima para consultas de auditoría | No | `90` | No | |

### 7.3 Tópicos y dispatch de eventos

| Variable | Propósito | Obligatorio | Por defecto | Secreto | Notas |
|----------|-----------|-------------|------------|---------|-------|
| `AUDIT_KAFKA_TOPIC` | Topic de auditoría de backup | No | `platform.backup.audit.events` | No | |
| `ALERT_TOPIC` | Topic de alertas fallback | No | `platform.audit.alerts` | No | Usado cuando la publicación falla |
| `KAFKA_TOPIC` | Topic de operaciones de backup | No | `platform.backup.operation.events` | No | |
| `DISPATCHER_TIMEOUT_SECONDS` | Timeout del dispatcher | No | `300` | No | |
| `RESTORE_TIMEOUT_SECONDS` | Timeout de restore | No | `600` | No | |

## Notas de interpretación

- En varias acciones de `provisioning-orchestrator`, una variable puede ser técnicamente opcional en código pero operativamente obligatoria para un dominio concreto. En la tabla se marca como **condicional** cuando solo se exige si habilitas un collector/applier específico.
- Los topics de Kafka están expuestos como variables porque el repositorio permite personalizarlos por entorno sin tocar código.
- Cuando una variable se trata como secreto, debe llegar desde un `Secret` o una fuente equivalente del despliegue, no desde un `ConfigMap` público.
