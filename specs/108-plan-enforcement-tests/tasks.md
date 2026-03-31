# Tasks — US-PLAN-02-T06: Pruebas de Enforcement Coherente de Capabilities y Cuotas por Plan

**Rama**: `108-plan-enforcement-tests` | **Fecha**: 2026-03-31\
**Derivado de**: `plan.md` (secuencia de implementación recomendada, fases 1–6)\
**Contexto de implementación**: El agente implementador recibe **únicamente** `plan.md` y este fichero (`tasks.md`). No tiene acceso al `spec.md` ni a otros artefactos de la carpeta `specs/`. Todo el contexto técnico necesario está incluido aquí o referenciado a `plan.md`.

---

## Reglas de carry-forward para el agente implementador

1. **Leer primero**: `specs/108-plan-enforcement-tests/plan.md` completo antes de comenzar cualquier tarea.
2. **No modificar** ningún fichero fuera del mapa de ficheros listado en cada tarea.
3. **No crear** ficheros nuevos que no estén en el mapa de ficheros de la tarea en curso.
4. **No borrar** ficheros existentes no listados en el mapa.
5. Ejecutar los quality gates al final de cada tarea (ver sección de validación al final de este documento).
6. Si una tarea depende de una tarea anterior, verificar que los artefactos de esa tarea están presentes antes de comenzar.
7. **Preserve los ficheros no relacionados**: no tocar artefactos de specs `070`/`072` ni ningún otro fichero fuera del scope.
8. Cada tarea es atómica: debe poder mergearse de forma independiente sin romper el build.
9. El orden de las tareas es el orden correcto de implementación; respetar dependencias.
10. **Este es un proyecto de solo-tests**: no se modifica código de producción. Todos los ficheros son nuevos en `tests/integration/plan-enforcement/` o `tests/e2e-browser/plan-enforcement/`.

---

## Resumen de tareas

| # | Tarea | Fase | Depende de | Tipo |
|---|---|---|---|---|
| T-01 | Configuración y variables de entorno | 1 | — | NUEVO ficheros |
| T-02 | Helper de autenticación Keycloak | 1 | T-01 | NUEVO fichero |
| T-03 | Factories de tenant, plan, override, workspace y recurso | 1 | T-01, T-02 | NUEVO ficheros |
| T-04 | Helpers de cliente API, propagación y Kafka | 1 | T-01, T-02 | NUEVO ficheros |
| T-05 | Tests de coherencia resolución ↔ gateway (capabilities) | 2 | T-01–T-04 | NUEVO fichero |
| T-06 | Tests de coherencia resolución ↔ consola API (capabilities) | 2 | T-01–T-04 | NUEVO fichero |
| T-07 | Tests de coherencia gateway ↔ consola API | 2 | T-01–T-04 | NUEVO fichero |
| T-08 | Tests de enforcement de cuotas hard | 2 | T-01–T-04 | NUEVO fichero |
| T-09 | Tests de propagación de cambio de plan (upgrade/downgrade) | 3 | T-01–T-04 | NUEVO fichero |
| T-10 | Tests de propagación de override (CRUD + expiración) | 3 | T-01–T-04 | NUEVO fichero |
| T-11 | Tests de deny-by-default ante fallo de resolución | 3 | T-01–T-04 | NUEVO fichero |
| T-12 | Tests de enforcement de cuotas soft con grace margin | 4 | T-01–T-04 | NUEVO fichero |
| T-13 | Tests de coherencia workspace subcuota | 4 | T-01–T-04 | NUEVO fichero |
| T-14 | Tests de ortogonalidad capability-cuota y aislamiento multi-tenant | 4 | T-01–T-04 | NUEVO fichero |
| T-15 | Tests de auditoría de enforcement | 4 | T-01–T-04 | NUEVO fichero |
| T-16 | Tests E2E de browser (Playwright) para consola | 5 | T-01–T-04, T-06 | NUEVO ficheros |
| T-17 | Integración CI, README y reporte | 6 | T-01–T-16 | NUEVO ficheros |

---

## T-01 — Configuración y variables de entorno

### Alcance

Crear el directorio base de la suite y los ficheros de configuración que definen las variables de entorno, los planes de prueba (seed data) y el catálogo de capabilities para tests.

### Criterios de aceptación

- [ ] El directorio `tests/integration/plan-enforcement/config/` existe.
- [ ] `test-env.mjs` exporta un objeto `env` que lee todas las variables de entorno documentadas en `plan.md` § "Variables de entorno requeridas" con valores por defecto sensibles para desarrollo local.
- [ ] `test-env.mjs` lanza un error claro si alguna variable obligatoria no está definida (`GATEWAY_BASE_URL`, `CONTROL_PLANE_URL`, `KEYCLOAK_URL`, `SUPERADMIN_CLIENT_ID`, `SUPERADMIN_CLIENT_SECRET`).
- [ ] `test-plans.mjs` exporta las definiciones de los 3 planes de prueba (`test-starter`, `test-professional`, `test-enterprise`) con capabilities y cuotas exactas según `plan.md` § "Seed data: planes de prueba".
- [ ] `test-capabilities.mjs` exporta la lista de las 7 capabilities del catálogo (`sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions`) con sus rutas capability-gated conocidas.
- [ ] Todos los ficheros usan ESM (`import`/`export`) y son compatibles con Node.js 20+.

### Notas de implementación

- Las variables de entorno siguen la convención del plan: `GATEWAY_BASE_URL`, `CONTROL_PLANE_URL`, `CONSOLE_API_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, etc.
- `test-plans.mjs` no inserta datos: solo define las estructuras. La inserción es responsabilidad de `plan-factory.mjs` (T-03).
- Para `test-capabilities.mjs`, incluir un mapa `capability → [{ method, path }]` con al menos 2 rutas por capability, basándose en la estructura de `services/gateway-config/routes/capability-gated-routes.yaml` (creado en spec 107 T-01).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/config/test-env.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/config/test-plans.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/config/test-capabilities.mjs` | **WRITE** (crear) |
| `specs/108-plan-enforcement-tests/plan.md` | READ |

---

## T-02 — Helper de autenticación Keycloak

### Alcance

Crear el helper que obtiene tokens JWT de Keycloak para los distintos actores de prueba (superadmin, tenant owner, workspace admin). Los tokens se cachean por ejecución con refresh automático.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/helpers/auth.mjs`.
- [ ] Exporta `getSuperadminToken()` que usa client credentials grant con `SUPERADMIN_CLIENT_ID` / `SUPERADMIN_CLIENT_SECRET`.
- [ ] Exporta `getTenantOwnerToken(tenantId)` que obtiene un token con scope de tenant owner.
- [ ] Exporta `getWorkspaceAdminToken(tenantId, workspaceId)` que obtiene un token con scope de workspace admin.
- [ ] Los tokens se cachean en memoria (Map) con TTL basado en `expires_in` del response de Keycloak, y se refrescan automáticamente al expirar.
- [ ] Si Keycloak no está disponible, las funciones lanzan un error descriptivo (`AuthError: Keycloak unreachable at ${url}`).
- [ ] No hay credenciales hardcodeadas; todas se leen de `test-env.mjs`.

### Notas de implementación

- Usar `fetch` nativo de Node.js 20+.
- El endpoint de Keycloak es `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`.
- Para tenant owner y workspace admin, se puede usar ROPC grant con usuarios de prueba creados por `tenant-factory.mjs`, o un token exchange / impersonation si el realm lo soporta.
- Incluir un `clearTokenCache()` exportado para uso en teardown global.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/helpers/auth.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/config/test-env.mjs` | READ |

---

## T-03 — Factories de tenant, plan, override, workspace y recurso

### Alcance

Crear los helpers tipo factory que encapsulan la creación y teardown de entidades de prueba. Cada factory es idempotente y usa prefijos únicos (`test-t06-{uuid}`) para evitar colisiones.

### Criterios de aceptación

**tenant-factory.mjs**
- [ ] Exporta `createTestTenant(options?)` que crea un tenant vía API de superadmin, con nombre prefijado `test-t06-{uuid}`.
- [ ] Exporta `deleteTestTenant(tenantId)` que limpia el tenant y todos sus recursos.
- [ ] Mantiene un registro interno de tenants creados para cleanup global.
- [ ] Exporta `cleanupAllTestTenants()` para teardown al final de la suite.

**plan-factory.mjs**
- [ ] Exporta `ensureTestPlans()` que crea/verifica la existencia de los 3 planes de prueba definidos en `test-plans.mjs`.
- [ ] Exporta `assignPlan(tenantId, planSlug)` que asigna un plan a un tenant.
- [ ] Exporta `changePlan(tenantId, newPlanSlug)` que cambia el plan de un tenant (upgrade/downgrade).
- [ ] Los planes de prueba se crean idempotentemente (si ya existen, no fallan).

**override-factory.mjs**
- [ ] Exporta `createOverride(tenantId, { dimension, value, type?, justification?, expiresAt? })` para overrides numéricos.
- [ ] Exporta `createCapabilityOverride(tenantId, { capability, enabled, justification? })` para overrides booleanos.
- [ ] Exporta `revokeOverride(tenantId, overrideId, justification?)`.
- [ ] Exporta `revokeAllOverrides(tenantId)` para teardown.

**workspace-factory.mjs**
- [ ] Exporta `createWorkspace(tenantId, name)` que crea un workspace dentro de un tenant.
- [ ] Exporta `setSubQuota(tenantId, workspaceId, dimension, value)` que asigna una subcuota.
- [ ] Exporta `deleteWorkspace(tenantId, workspaceId)`.

**resource-factory.mjs**
- [ ] Exporta funciones para crear recursos concretos: `createDatabase(tenantId, workspaceId)`, `createKafkaTopic(tenantId, workspaceId)`, `createFunction(tenantId, workspaceId)`, `createWebhook(tenantId, workspaceId)`.
- [ ] Cada función devuelve un objeto con `id` y datos del recurso creado.
- [ ] Exporta `deleteResource(type, tenantId, workspaceId, resourceId)` genérico.

### Notas de implementación

- Todas las factories usan `auth.mjs` (T-02) para obtener el token apropiado.
- Todas las factories usan `api-client.mjs` (T-04) para las llamadas HTTP.
- Los UUIDs se generan con `crypto.randomUUID()`.
- El cleanup registra errores pero no falla si un recurso ya fue eliminado (idempotencia).
- Las factories deben funcionar con el API existente del control plane (acciones OpenWhisk documentadas en specs 097–107).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/helpers/tenant-factory.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/plan-factory.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/override-factory.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/workspace-factory.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/resource-factory.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/auth.mjs` | READ |
| `tests/integration/plan-enforcement/config/test-env.mjs` | READ |
| `tests/integration/plan-enforcement/config/test-plans.mjs` | READ |

---

## T-04 — Helpers de cliente API, propagación y Kafka

### Alcance

Crear los helpers de infraestructura: cliente HTTP genérico, cliente de consola API, consumidor Kafka para eventos de auditoría, helper de espera de propagación, y generador de reporte.

### Criterios de aceptación

**api-client.mjs**
- [ ] Exporta `gatewayRequest(method, path, { token, body?, headers? })` que hace requests al gateway (`GATEWAY_BASE_URL`).
- [ ] Exporta `controlPlaneRequest(method, path, { token, body?, headers? })` que hace requests al control plane (`CONTROL_PLANE_URL`).
- [ ] Ambas funciones devuelven `{ status, headers, body }` parseado.
- [ ] Ambas incluyen retry con backoff para errores 5xx transitorios (máx. 3 reintentos).

**console-api-client.mjs**
- [ ] Exporta `getConsoleEntitlements(tenantId, token)` que consulta el endpoint JSON de entitlements de la consola.
- [ ] Exporta `getConsoleCapabilities(tenantId, token)` que consulta el endpoint JSON de capabilities de la consola.
- [ ] Exporta `getConsoleQuotas(tenantId, token)` que consulta el endpoint JSON de cuotas/consumo de la consola.
- [ ] Exporta `getWorkspaceDashboard(tenantId, workspaceId, token)` que consulta el dashboard de workspace.

**kafka-consumer.mjs**
- [ ] Exporta `createAuditConsumer(groupId?)` que crea un consumidor Kafka conectado al topic `KAFKA_AUDIT_TOPIC`.
- [ ] Exporta `waitForAuditEvent(consumer, { eventType, tenantId, timeoutMs? })` que espera un evento específico con polling.
- [ ] Exporta `disconnectConsumer(consumer)` para teardown.
- [ ] El consumer usa un group ID único por ejecución para evitar interferencia.

**wait-for-propagation.mjs**
- [ ] Exporta `waitForPropagation(checkFn, { expectedValue, intervalMs?, timeoutMs? })` genérico.
- [ ] `checkFn` es una función async que devuelve el valor actual.
- [ ] Hace polling cada `intervalMs` (default 500ms) hasta que `checkFn()` devuelve `expectedValue` o el timeout expira.
- [ ] Al expirar, lanza un error descriptivo con el último valor observado vs. el esperado.
- [ ] El timeout por defecto es `PROPAGATION_TTL_MS` de la configuración.

**report.mjs**
- [ ] Exporta `TestReporter` class que acumula resultados de tests.
- [ ] Método `addResult({ name, scenario, subsystems, result, durationMs, detail? })`.
- [ ] Método `writeReport(outputPath)` que genera el JSON según el schema definido en `plan.md` § "Reporte de resultados".
- [ ] Método `getSummary()` que devuelve `{ total, passed, failed }`.

### Notas de implementación

- `api-client.mjs` usa `fetch` nativo.
- `kafka-consumer.mjs` usa `kafkajs` (verificar que está en las dependencias del monorepo, o documentar que debe instalarse).
- `wait-for-propagation.mjs` es un helper puro sin dependencias externas.
- `report.mjs` escribe JSON formateado con `JSON.stringify(data, null, 2)`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/helpers/api-client.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/console-api-client.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/kafka-consumer.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/wait-for-propagation.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/report.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/config/test-env.mjs` | READ |

---

## T-05 — Tests de coherencia resolución ↔ gateway (capabilities)

### Alcance

Implementar la suite de tests que verifica RF-T06-01: para cada capability booleana del catálogo, el resultado de la resolución de entitlements y la decisión del gateway son idénticos. Cubre las 7 capabilities × 2 estados (habilitado/deshabilitado) = 14 verificaciones mínimas.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/01-resolution-gateway-coherence.test.mjs`.
- [ ] Para cada una de las 7 capabilities (`sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions`):
  - [ ] Existe un test que crea un tenant con la capability **habilitada**, consulta resolución (debe ser `true`), y hace request al gateway a una ruta gated (debe ser `2xx`).
  - [ ] Existe un test que crea un tenant con la capability **deshabilitada**, consulta resolución (debe ser `false`), y hace request al gateway (debe ser `402` con error estandarizado).
- [ ] Cada test usa su propio tenant de prueba (setup/teardown aislado).
- [ ] Los tests se pueden ejecutar de forma independiente y en cualquier orden.
- [ ] Cubre CA-01 del spec.

### Notas de implementación

- Usar `node:test` con `describe`/`it`.
- En el setup de cada test: `createTestTenant()` → `ensureTestPlans()` → `assignPlan()`.
- Para capability habilitada usar `test-professional` (tiene 4 de 7) o `test-enterprise` (tiene todas).
- Para capability deshabilitada usar `test-starter` (tiene 0 de 7).
- Las rutas gated por capability se obtienen de `test-capabilities.mjs`.
- Verificar que el cuerpo del error 402 incluye `capability`, `reason`, y `upgrade_hint` según spec 107.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/01-resolution-gateway-coherence.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-06 — Tests de coherencia resolución ↔ consola API (capabilities)

### Alcance

Implementar la suite de tests que verifica RF-T06-02: el estado de capabilities y cuotas mostrado por los endpoints JSON de la consola coincide con la resolución de entitlements.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/02-resolution-console-coherence.test.mjs`.
- [ ] Para al menos 3 capabilities representativas (`realtime`, `webhooks`, `sql_admin_api`):
  - [ ] Existe un test que verifica capability habilitada: resolución `true` → consola API muestra la capability como `enabled`.
  - [ ] Existe un test que verifica capability deshabilitada: resolución `false` → consola API muestra la capability como `disabled`.
- [ ] Para al menos 2 cuotas representativas (`max_workspaces`, `max_pg_databases`):
  - [ ] Existe un test que verifica que el límite efectivo en resolución coincide con el mostrado por la consola API.
  - [ ] Existe un test que verifica que el consumo actual mostrado por la consola API corresponde a los recursos realmente creados.
- [ ] Cubre CA-02 del spec.

### Notas de implementación

- Los endpoints de consola API a consultar son los definidos en `console-api-client.mjs` (T-04).
- La consola puede tener su propia caché; si hay discrepancia, usar `waitForPropagation()` antes de fallar.
- Verificar tanto el valor como la metadata (source: plan/override/catalog_default).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/02-resolution-console-coherence.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-07 — Tests de coherencia gateway ↔ consola API

### Alcance

Implementar la suite de tests que verifica RF-T06-03: para una capability deshabilitada, tanto el gateway como la consola coinciden en el rechazo/ocultación; para una habilitada, ambos coinciden en permitir/mostrar.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/03-gateway-console-coherence.test.mjs`.
- [ ] Al menos 2 tests verifican que una capability deshabilitada es rechazada por el gateway (402) Y mostrada como disabled por la consola API.
- [ ] Al menos 2 tests verifican que una capability habilitada es permitida por el gateway (2xx) Y mostrada como enabled por la consola API.
- [ ] Al menos 1 test verifica coherencia gateway-consola para una cuota (gateway bloquea al límite, consola muestra consumo al límite).
- [ ] Cubre CA-03 parcialmente (coherencia gateway-consola).

### Notas de implementación

- Estos tests son complementarios a T-05 y T-06. Aquí se verifica la coherencia directa gateway ↔ consola sin pasar por resolución como intermediario.
- Crear el recurso necesario para llevar una cuota al límite exacto, verificar bloqueo en gateway, luego consultar consola.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/03-gateway-console-coherence.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-08 — Tests de enforcement de cuotas hard

### Alcance

Implementar la suite de tests que verifica RF-T06-06: las cuotas hard bloquean correctamente la creación del recurso N+1, y el bloqueo es coherente entre gateway y resolución.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/06-hard-quota-enforcement.test.mjs`.
- [ ] Existe un test que: crea un tenant con `max_workspaces: 3 (hard)`, crea 3 workspaces (éxito), intenta crear el 4º (debe fallar con `QUOTA_HARD_LIMIT_REACHED`).
- [ ] Existe un test que: verifica que el gateway devuelve el error con `dimension`, `current_usage`, `effective_limit` en el cuerpo.
- [ ] Existe un test que: verifica que la resolución de entitlements muestra el mismo límite efectivo que el gateway usa para bloquear.
- [ ] Existe un test que: verifica que la cuota `-1` (unlimited) no bloquea la creación.
- [ ] Cubre CA-03 del spec.

### Notas de implementación

- Usar `resource-factory.mjs` para crear workspaces u otros recursos medibles.
- El error `QUOTA_HARD_LIMIT_REACHED` es el definido en spec 103.
- Verificar coherencia: `resolución.effective_limit == error.effective_limit`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/06-hard-quota-enforcement.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-09 — Tests de propagación de cambio de plan (upgrade/downgrade)

### Alcance

Implementar la suite de tests que verifica RF-T06-04: un cambio de plan (upgrade y downgrade) se refleja en resolución, gateway y consola API dentro del TTL configurado.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/04-plan-change-propagation.test.mjs`.

**Test de upgrade (CA-05)**:
- [ ] Crea tenant con `test-starter` (sin `realtime`, `max_workspaces: 3`).
- [ ] Verifica estado pre-upgrade: resolución `realtime: false`, gateway bloquea `/realtime/subscribe`, consola muestra `realtime: disabled`.
- [ ] Cambia plan a `test-professional`.
- [ ] Usa `waitForPropagation()` para esperar convergencia.
- [ ] Verifica estado post-upgrade: resolución `realtime: true`, gateway permite `/realtime/subscribe`, consola muestra `realtime: enabled`.
- [ ] Verifica que `max_workspaces` se actualizó de 3 a 10 en resolución.

**Test de downgrade (CA-06)**:
- [ ] Crea tenant con `test-professional`, crea 8 workspaces.
- [ ] Cambia plan a `test-starter` (`max_workspaces: 3`).
- [ ] Usa `waitForPropagation()`.
- [ ] Verifica: resolución `realtime: false`, `max_workspaces: 3`; gateway bloquea `/realtime/subscribe`; gateway bloquea creación de workspace nuevo (over-limit 8/3).
- [ ] Verifica que los 8 workspaces existentes NO se eliminaron.
- [ ] Consola muestra condición over-limit.

### Notas de implementación

- Estos tests son los más sensibles al TTL. El `PROPAGATION_TTL_MS` debe ser suficiente.
- Registrar en el reporte el tiempo exacto entre el cambio y la primera respuesta coherente.
- Si el entorno tiene TTL > 60s, estos tests serán los más lentos de la suite.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/04-plan-change-propagation.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-10 — Tests de propagación de override (CRUD + expiración)

### Alcance

Implementar la suite de tests que verifica RF-T06-05: la creación, modificación, revocación y expiración de overrides se reflejan coherentemente en resolución, gateway y consola.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/05-override-propagation.test.mjs`.

**Override habilitante de capability (CA-07a)**:
- [ ] Tenant en `test-starter`, override `webhooks: true`.
- [ ] Resolución: `webhooks: true (source: override)`. Gateway: permite `/webhooks`. Consola: `webhooks: enabled`.

**Override restrictivo de capability (CA-07b)**:
- [ ] Tenant en `test-professional`, override `sql_admin_api: false`.
- [ ] Resolución: `sql_admin_api: false (source: override)`. Gateway: bloquea `/admin/sql`. Consola: `sql_admin_api: disabled`.

**Override numérico de cuota (CA-07c)**:
- [ ] Tenant en `test-starter` (`max_pg_databases: 5`), override `max_pg_databases: 15`.
- [ ] Resolución: `max_pg_databases: 15 (source: override)`. Gateway: permite crear DBs hasta 15.

**Revocación de override (CA-07d)**:
- [ ] Revocar override de CA-07c. Resolución vuelve a `max_pg_databases: 5 (source: plan)`.
- [ ] Si consumo es 12, consola muestra over-limit.

**Expiración de override (CA-08)**:
- [ ] Override con `expiresAt` en 30 segundos. Esperar expiración + sweep cycle.
- [ ] Verificar que resolución y gateway ya no aplican el override.

### Notas de implementación

- Para la expiración, usar un override con TTL muy corto (30s) y esperar el sweep cycle.
- Si el sweep cycle es configurable, documentarlo. Si no, usar un timeout generoso.
- El test de expiración puede ser flaky si el sweep cycle es impredecible; marcarlo como `{ todo: 'requires sweep cycle < 60s' }` si no se puede garantizar.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/05-override-propagation.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-11 — Tests de deny-by-default ante fallo de resolución

### Alcance

Implementar la suite de tests que verifica RF-T06-10: cuando el servicio de resolución no está disponible, el gateway aplica deny-by-default.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/10-deny-by-default.test.mjs`.
- [ ] Existe un test que: simula la indisponibilidad del servicio de resolución (vía mecanismo documentado).
- [ ] Verifica que el gateway bloquea requests a rutas capability-gated con un error que indica degradación, no un error genérico.
- [ ] Verifica que la consola muestra un estado de error de carga de capabilities (no datos stale).
- [ ] Restaura el servicio de resolución en el teardown.
- [ ] Cubre CA-09 y EC-07 del spec.

### Notas de implementación

- El mecanismo de inyección de fallos es una pregunta abierta del spec (P-04). Posibles estrategias:
  1. Feature flag que desactiva el endpoint de resolución.
  2. Scalear a 0 réplicas el pod de resolución vía `kubectl scale`.
  3. Inyectar un fault vía service mesh (Istio fault injection).
  4. Configurar el plugin APISIX para apuntar a un upstream inexistente temporalmente.
- Documentar la estrategia elegida en el test como comentario.
- Si ninguna estrategia es viable en el entorno de test, marcar el test como `skip` con explicación.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/10-deny-by-default.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-12 — Tests de enforcement de cuotas soft con grace margin

### Alcance

Implementar la suite de tests que verifica RF-T06-07: cuotas soft permiten creación dentro de la grace margin con warning, y bloquean más allá.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/07-soft-quota-grace-enforcement.test.mjs`.
- [ ] Existe un test de transición completa (CA-04):
  - [ ] Tenant con `max_kafka_topics: 5 (soft, grace: 2)`. Crea 5 topics (éxito normal).
  - [ ] Crea el 6º topic: éxito + header `X-Quota-Warning` + evento `quota.soft_limit.exceeded` en Kafka.
  - [ ] Crea el 7º topic: éxito + warning (aún dentro de grace).
  - [ ] Intenta crear el 8º topic: bloqueado con `QUOTA_SOFT_LIMIT_GRACE_EXHAUSTED`.
- [ ] Existe un test que verifica la coherencia resolución-gateway para soft quotas: resolución indica `soft` + `grace_margin`, gateway aplica el comportamiento correspondiente.
- [ ] Existe un test de transición soft → hard por cambio de plan: tenant con soft quota cambia a plan con la misma dimensión como hard, y el comportamiento se ajusta.

### Notas de implementación

- Verificar el header `X-Quota-Warning` en la respuesta del gateway.
- Usar `kafka-consumer.mjs` para verificar el evento de auditoría.
- El test de 5+2+1 requiere crear 8 recursos; usar `resource-factory.mjs` con cleanup posterior.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/07-soft-quota-grace-enforcement.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-13 — Tests de coherencia workspace subcuota

### Alcance

Implementar la suite de tests que verifica RF-T06-08 y RF-T06-09: las subcuotas de workspace se respetan, la suma no excede el tenant, y los cambios upstream generan señalización de inconsistencia.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/08-workspace-subquota-coherence.test.mjs`.

**Subcuota se respeta en enforcement (CA-10a)**:
- [ ] Tenant con `max_pg_databases: 10`, workspace `ws-prod` con subcuota `6`, workspace `ws-dev` con subcuota `4`.
- [ ] `ws-prod` puede crear 6 DBs; la 7ª es bloqueada.
- [ ] `ws-dev` puede crear 4 DBs; la 5ª es bloqueada.

**Suma no excede tenant (CA-10b)**:
- [ ] Intentar asignar subcuota que haría sum > tenant limit → rechazado.

**Inconsistencia por downgrade (CA-10c, RF-T06-09)**:
- [ ] Tenant con override `max_pg_databases: 10`, subcuotas 6+4. Revocar override → tenant limit baja a 5 (plan base).
- [ ] Las subcuotas 6+4=10 > 5 son señalizadas como inconsistentes.
- [ ] Las subcuotas NO se modifican automáticamente.
- [ ] Consola muestra warning de inconsistencia.

**Workspace sin subcuota (EC-09)**:
- [ ] Workspace sin subcuota consume del pool compartido; creación tiene éxito mientras el total del tenant no exceda.

### Notas de implementación

- Las subcuotas se gestionan con `workspace-factory.mjs`.
- La señalización de inconsistencia puede ser un campo en la respuesta de resolución y/o un evento.
- Verificar tanto la respuesta de la API como la consola.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/08-workspace-subquota-coherence.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-14 — Tests de ortogonalidad capability-cuota y aislamiento multi-tenant

### Alcance

Implementar tests para RF-T06-12 (ortogonalidad capability-cuota) y RF-T06-14 (aislamiento multi-tenant).

### Criterios de aceptación

**Ortogonalidad (CA-12)**:
- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/12-capability-quota-orthogonality.test.mjs`.
- [ ] Existe un test para EC-02: capability habilitada (`webhooks: true`) + cuota `max_webhooks: 0`. Gateway permite la ruta (`GET /webhooks`) pero bloquea la creación del recurso (`POST /webhooks`) por cuota. Los errores son distintos: 402 para capability vs. 429/403 para cuota.
- [ ] Existe un test para EC-03: cuota unlimited (`-1`) + capability deshabilitada. Gateway bloquea la ruta por capability (no se evalúa cuota). Consola oculta/deshabilita la sección.
- [ ] Existe un test para EC-04: override habilitante + override numérico simultáneos. Ambos se reflejan coherentemente.

**Aislamiento multi-tenant (CA-14)**:
- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/13-multi-tenant-isolation.test.mjs`.
- [ ] Crea dos tenants con planes diferentes (`test-starter` y `test-professional`).
- [ ] Verifica que las capabilities y cuotas de cada uno son independientes.
- [ ] Verifica que un tenant no puede ver ni acceder a recursos del otro.
- [ ] Verifica que un override en un tenant no afecta al otro.

### Notas de implementación

- Para EC-02, se necesita una capability que tenga tanto una ruta de lectura como una de creación de recurso asociada.
- Los tests de aislamiento crean 2 tenants en paralelo y verifican independencia.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/12-capability-quota-orthogonality.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/suites/13-multi-tenant-isolation.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-15 — Tests de auditoría de enforcement

### Alcance

Implementar la suite de tests que verifica RF-T06-11: cada rechazo por capability o cuota genera un evento de auditoría con los campos obligatorios.

### Criterios de aceptación

- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/11-audit-enforcement-events.test.mjs`.

**Rechazo por capability (CA-11a)**:
- [ ] Provocar un rechazo de capability (tenant en `test-starter` hace request a ruta gated).
- [ ] Verificar que se emite un evento `capability_enforcement_denied` en Kafka con campos: `tenant_id`, `capability`, `route`, `timestamp`, `actor`, `plan_slug`.

**Rechazo por cuota hard (CA-11b)**:
- [ ] Provocar un rechazo de cuota hard (tenant al límite intenta crear recurso).
- [ ] Verificar que se emite un evento `quota.hard_limit.blocked` en Kafka con campos: `tenant_id`, `dimension`, `current_usage`, `effective_limit`, `timestamp`, `actor`.

**Rechazo por cuota soft grace exhausted (CA-11c)**:
- [ ] Provocar un rechazo de cuota soft beyond grace.
- [ ] Verificar que se emite un evento `quota.soft_limit.grace_exhausted` con los campos obligatorios.

**Warning de soft limit exceeded (CA-11d)**:
- [ ] Provocar una creación en zona de gracia.
- [ ] Verificar que se emite un evento `quota.soft_limit.exceeded` (no blocking, solo warning).

### Notas de implementación

- Usar `kafka-consumer.mjs` para capturar eventos.
- Los campos obligatorios de auditoría están definidos en spec 103 (RN-06) y spec 107 (sección 5.3).
- Dar un timeout generoso al consumer porque los eventos pueden tener latencia de producción.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/suites/11-audit-enforcement-events.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-16 — Tests E2E de browser (Playwright) para consola

### Alcance

Implementar tests con Playwright que verifican que la consola React refleja correctamente capabilities y cuotas en el browser real. Estos tests son opcionales y se controlan con `BROWSER_TEST_ENABLED`.

### Criterios de aceptación

- [ ] Los ficheros existen en `tests/e2e-browser/plan-enforcement/`.

**console-capability-display.spec.ts**:
- [ ] Test de capabilities habilitadas: login como tenant owner de `test-professional`, verificar que las secciones de realtime, webhooks, sql_admin_api están visibles y activas.
- [ ] Test de capabilities deshabilitadas: login como tenant owner de `test-starter`, verificar que las secciones premium están deshabilitadas con indicador de restricción.
- [ ] Test de transición: cambiar plan vía API, recargar consola, verificar que el estado se actualiza.

**console-quota-display.spec.ts**:
- [ ] Test de consumo normal: verificar barras de progreso con porcentajes correctos.
- [ ] Test de over-limit: verificar indicador visual de over-limit tras downgrade.
- [ ] Test de override: verificar badge/indicador de override en la dimensión afectada.

- [ ] Todos los tests se saltan si `BROWSER_TEST_ENABLED !== 'true'`.
- [ ] Todos los tests usan tenants de prueba dedicados con cleanup.

### Notas de implementación

- Playwright config en `tests/e2e-browser/playwright.config.ts` (puede ya existir en el proyecto; si no, crear uno mínimo).
- Login vía UI o inyección de token (según la infra de auth de la consola).
- Selectores CSS/data-testid según los componentes de consola definidos en spec 106.
- Estos tests son los más frágiles; priorizar data-testid sobre selectores visuales.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/e2e-browser/plan-enforcement/console-capability-display.spec.ts` | **WRITE** (crear) |
| `tests/e2e-browser/plan-enforcement/console-quota-display.spec.ts` | **WRITE** (crear) |
| `tests/e2e-browser/playwright.config.ts` | **WRITE** (crear si no existe) / **READ** (si ya existe) |
| `tests/integration/plan-enforcement/helpers/*` | READ |
| `tests/integration/plan-enforcement/config/*` | READ |

---

## T-17 — Integración CI, README y reporte

### Alcance

Crear el README de la suite, el script de ejecución para CI, y la configuración necesaria para integrar la suite en el pipeline.

### Criterios de aceptación

**README.md**:
- [ ] El fichero existe en `tests/integration/plan-enforcement/README.md`.
- [ ] Documenta: propósito de la suite, prerrequisitos (servicios desplegados, variables de entorno), cómo ejecutar localmente, cómo ejecutar en CI, estructura de directorios, cómo añadir nuevos tests.
- [ ] Incluye tabla de cobertura: para cada CA del spec, indica qué fichero(s) de test lo cubren.

**Script de ejecución**:
- [ ] El fichero existe en `tests/integration/plan-enforcement/run-suite.sh`.
- [ ] Ejecuta health-checks previos (conectividad a gateway, control plane, Keycloak, Kafka).
- [ ] Ejecuta la suite de tests de API con `node --test tests/integration/plan-enforcement/suites/*.test.mjs`.
- [ ] Si `BROWSER_TEST_ENABLED=true`, ejecuta los tests de Playwright.
- [ ] Genera el reporte JSON al final.
- [ ] Devuelve exit code 0 si todo pasa, 1 si hay fallos.

**Lifecycle completo (E2E integrador)**:
- [ ] El fichero existe en `tests/integration/plan-enforcement/suites/14-full-lifecycle-e2e.test.mjs`.
- [ ] Ejecuta un escenario completo que cubre E1–E8 del spec en secuencia con un solo tenant:
  1. Crear tenant → asignar `test-professional` → verificar coherencia (E1)
  2. Crear workspaces + subcuotas → verificar enforcement (E8)
  3. Crear override habilitante → verificar propagación (E4)
  4. Crear override restrictivo → verificar propagación (E5)
  5. Override numérico → verificar (E6)
  6. Soft quota + grace → verificar (E7)
  7. Downgrade → verificar (E3)
  8. Upgrade → verificar (E2)
  9. Teardown completo

### Notas de implementación

- El script `run-suite.sh` debe ser ejecutable (`chmod +x`).
- Los health-checks usan `curl` o el `api-client.mjs` para verificar conectividad.
- El test de lifecycle completo es largo (~3 min) pero cubre la coherencia secuencial que los tests individuales no capturan.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/integration/plan-enforcement/README.md` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/run-suite.sh` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/suites/14-full-lifecycle-e2e.test.mjs` | **WRITE** (crear) |
| `tests/integration/plan-enforcement/helpers/report.mjs` | READ |
| `specs/108-plan-enforcement-tests/spec.md` | READ |

---

## Validación post-tarea

Al completar cada tarea, el agente implementador debe ejecutar:

```bash
# 1. Verificar que los ficheros creados son ESM válido (sin errores de sintaxis)
node --check tests/integration/plan-enforcement/config/*.mjs 2>/dev/null
node --check tests/integration/plan-enforcement/helpers/*.mjs 2>/dev/null
node --check tests/integration/plan-enforcement/suites/*.test.mjs 2>/dev/null

# 2. Verificar que no se han modificado ficheros fuera del scope
git diff --name-only | grep -v '^tests/' | grep -v '^specs/108'

# 3. Verificar que los specs 070/072 no han sido alterados
git diff --name-only specs/070-* specs/072-* 2>/dev/null  # debe estar vacío

# 4. Lint YAML si hay ficheros YAML nuevos
# yamllint <file> (si disponible)
```

## Cobertura de criterios de aceptación

| CA | Test(s) que lo cubren |
|----|----------------------|
| CA-01 | T-05 (`01-resolution-gateway-coherence.test.mjs`) |
| CA-02 | T-06 (`02-resolution-console-coherence.test.mjs`) |
| CA-03 | T-08 (`06-hard-quota-enforcement.test.mjs`) + T-07 (`03-gateway-console-coherence.test.mjs`) |
| CA-04 | T-12 (`07-soft-quota-grace-enforcement.test.mjs`) |
| CA-05 | T-09 (`04-plan-change-propagation.test.mjs`) |
| CA-06 | T-09 (`04-plan-change-propagation.test.mjs`) |
| CA-07 | T-10 (`05-override-propagation.test.mjs`) |
| CA-08 | T-10 (`05-override-propagation.test.mjs`) |
| CA-09 | T-11 (`10-deny-by-default.test.mjs`) |
| CA-10 | T-13 (`08-workspace-subquota-coherence.test.mjs`) |
| CA-11 | T-15 (`11-audit-enforcement-events.test.mjs`) |
| CA-12 | T-14 (`12-capability-quota-orthogonality.test.mjs`) |
| CA-13 | T-17 (`run-suite.sh` + CI integration) |
| CA-14 | T-14 (`13-multi-tenant-isolation.test.mjs`) |

---

*Documento generado para el stage `speckit.tasks` — US-PLAN-02-T06 | Rama: `108-plan-enforcement-tests`*
