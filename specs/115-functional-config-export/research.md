# Research Spike — US-BKP-02-T01: Dependencias externas y decisiones técnicas

**Fecha**: 2026-04-01 | **Branch**: `115-functional-config-export`

---

## 1. Modelo de tenants (US-TEN-04) — Convención de scoping por subsistema

**Estado**: US-TEN-04 asumido completado. No existe un registro centralizado de namespace-per-tenant explícito en el monorepo al momento de esta tarea.

**Decisión**: Cada recolector usa la convención documentada del proyecto para identificar los recursos del tenant en su subsistema:

| Subsistema | Convención de scoping del tenant |
|---|---|
| Keycloak | Realm dedicado por tenant (o grupo en realm compartido): `tenant_id` como identificador de realm/group |
| PostgreSQL | Schema dedicado por tenant: `schema_name = tenant_id` o prefijo configurable vía `CONFIG_EXPORT_PG_SCHEMA_PREFIX` |
| MongoDB | Database dedicada por tenant: `db_name = tenant_id` o prefijo vía `CONFIG_EXPORT_MONGO_DB_PREFIX` |
| Kafka | Prefijo de topic: `{tenant_id}.` — convención ya establecida en otros recolectores del proyecto |
| OpenWhisk | Namespace dedicado: `namespace = tenant_id` |
| S3 | Prefijo de bucket: `{tenant_id}-` o bucket dedicado por tenant |

**Fallback**: Si el registro centralizado de namespaces está disponible (tabla futura de US-TEN-04), el registry de recolectores lo consultará primero. Si no, usa las env vars de prefijo.

---

## 2. Perfil de despliegue (US-BKP-01 / US-DEP-03)

**Estado**: `deployment_profile_registry` existe en PostgreSQL (spec 114). US-DEP-03 no está formalizado.

**Decisión**: Reutilizar la tabla `deployment_profile_registry` de spec 114 para determinar el perfil activo. Si la tabla no existe o no hay perfil activo, usar `CONFIG_EXPORT_DEPLOYMENT_PROFILE` (default: `standard`).

El registro de recolectores (`registry.mjs`) consulta el perfil activo al inicializarse y marca como `not_available` los dominios cuyo componente no está en el perfil.

**Fallback explícito** para configuración de componentes opcionales:
- `CONFIG_EXPORT_OW_ENABLED=false` → funciones devuelve `not_available`
- `CONFIG_EXPORT_MONGO_ENABLED=false` → mongo devuelve `not_available`

---

## 3. Pipeline de auditoría (US-OBS-01)

**Estado**: Pipeline operativo. Topic convencional `console.*` con retención estándar.

**Decisión**: Crear topic dedicado `console.config.export.completed` con retención 90 días. El evento es fire-and-forget desde la acción de exportación (no bloquea la respuesta HTTP). Si Kafka no está disponible, el evento falla silenciosamente con log de warning; la exportación no se aborta.

---

## 4. `backup-admin-routes.yaml` en services/gateway-config

**Estado**: Verificar existencia.

**Decisión**: Si existe `services/gateway-config/routes/backup-admin-routes.yaml`, añadir las dos rutas de config-export. Si no existe, crearlo. Seguir el mismo patrón YAML que `backup-status-routes.yaml` u otros ficheros de rutas existentes en el directorio.

---

## 5. Exportación síncrona vs. asíncrona (P-03 de spec)

**Estado**: Pregunta abierta de spec.

**Decisión**: Exportación síncrona en esta fase. Justificación:
- Tamaño M; 6 recolectores con timeout individual de 8 s; procesamiento paralelo con `Promise.allSettled`; tiempo total estimado ≤ 25 s en caso nominal.
- OpenWhisk default timeout es 60 s para acciones de API; configurable hasta 10 min.
- El artefacto se devuelve directamente como cuerpo HTTP; no requiere almacenamiento intermedio.
- Si el timeout de APISIX (upstream timeout) es inferior, se amplía en la ruta de config-export.

La exportación asíncrona (job poll) se diferiere a un refinamiento futuro fuera de esta tarea.

---

## 6. Código fuente de funciones OpenWhisk (P-02 de spec)

**Estado**: Pregunta abierta de spec.

**Decisión**: Incluir código fuente en el artefacto, codificado en **base64** en el campo `code_base64` de cada acción. Justificación:
- El artefacto debe ser autocontenido para soportar migración entre entornos sin dependencias externas.
- El límite `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` (default 10 MB) como salvaguarda ante artefactos excesivamente grandes.
- Si el código no está disponible vía API (funciones ZIP complejas), el campo aparece como `null` con `code_available: false`.

---

## 7. Redacción de secretos — Estrategia de detección

**Estado**: Riesgo R-04 de spec.

**Decisión**: Estrategia de dos capas en `types.mjs`:

**Capa 1 — Lista explícita por tipo de objeto** (implementada en cada recolector):
- IAM: campos `clientSecret`, `secret`, `privateKey`, `certificate`
- Funciones: campos `value` en parámetros anotados como `encrypt:true` (OpenWhisk)
- S3: no hay secretos en políticas de bucket; credenciales de acceso excluidas por diseño (no son config funcional)
- Kafka: `sasl.password`, `ssl.keystore.password`

**Capa 2 — Heurística de detección de patrones** (función `redactSensitiveFields` en types.mjs):
- Claves con nombres que contengan: `secret`, `password`, `passwd`, `token`, `key`, `credential`, `private`, `auth`
- Valores que coincidan con patrones de credenciales conocidos (JWT bearer, AWS key format, PEM headers)

El placeholder de redacción es `"***REDACTED***"` (string fijo, no null, para distinguir "redactado" de "sin valor").

---

## 8. Isolación multi-tenant en Kafka AdminClient

**Estado**: Necesita aclaración de implementación.

**Decisión**: El recolector Kafka filtra topics por prefijo `{tenant_id}.`. Las ACLs de Kafka se filtran consultando solo los recursos con `resourceName` que empiece por `{tenant_id}.`. Si el Kafka AdminClient no soporta filtrado server-side de ACLs por prefix, se hace client-side. Los consumer groups relevantes se identifican por convención de naming: `{tenant_id}.cg.*`.

---

## Resumen de variables de entorno nuevas

Ver plan.md sección "Variables de entorno nuevas" — 19 variables nuevas con defaults conservadores (`ENABLED=false` para componentes opcionales).

---

## Resumen de decisiones de diseño

| Decisión | Elegida | Alternativa rechazada | Motivo |
|---|---|---|---|
| Parallelismo de recolectores | `Promise.allSettled` | Secuencial | Reducir latencia total |
| Exportación síncrona | Síncrona | Asíncrona con poll | Simplicidad; latencia nominal < 30 s |
| Código fuente de funciones | Incluido (base64) | Solo referencia | Artefacto autocontenido |
| Almacenamiento del artefacto | No almacenado | Almacenado en DB/S3 | Fuera de alcance; se devuelve directo |
| Formato inicial | JSON `v1.0` (no versionado formalmente) | Esperar US-BKP-02-T02 | T02 formaliza compatibilidad; T01 produce contrato mínimo funcional |
| Redacción de secretos | Lista explícita + heurística | Solo heurística | Mayor seguridad con menor riesgo de falsos negativos |
