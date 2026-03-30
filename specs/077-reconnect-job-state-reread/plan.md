# Implementation Plan: Reconexión de Consola y Relectura de Estado de Jobs en Curso

**Task ID**: US-UIB-02-T05  
**Feature Branch**: `077-reconnect-job-state-reread`  
**Spec**: `specs/077-reconnect-job-state-reread/spec.md`  
**Created**: 2026-03-30  
**Status**: Ready for Implementation

---

## 1. Objetivo del Plan

Esta tarea implementa la **capacidad de reconexión y relectura de estado de jobs** para la consola de administración, y crea la cobertura de pruebas que la valida. Las tareas previas (T01–T04) han establecido:

- T01: modelo `async_operations` en PostgreSQL + FSM + eventos Kafka.
- T02: endpoints de consulta de progreso y componentes UI de seguimiento.
- T03: reintentos idempotentes con deduplicación por `idempotency_key`.
- T04: políticas de timeout, cancelación (`timed_out`, `cancelled`) y recuperación de huérfanos.

T05 cierra el ciclo garantizando que la consola, al recuperar conectividad o sesión, **reconcilia el estado local con el backend** y presenta al usuario el estado real de sus operaciones, al tiempo que previene acciones duplicadas y respeta el aislamiento multi-tenant.

Entregables clave:
1. Módulo React de reconciliación de estado al reconectar (`useReconnectStateSync` hook + lógica auxiliar).
2. Tests del comportamiento de reconexión/relectura (unitarios, integración UI y contrato).
3. Tests de seguridad multi-tenant para el flujo de relectura.
4. Documentación ADR.

---

## 2. Arquitectura y Flujo Objetivo

### 2.1 Flujo de reconexión

```text
[Navegador detecta online / reapertura de pestaña]
        │
        ▼
[useReconnectStateSync] ── ¿token válido? ──No──► [solicitar reautenticación]
        │Yes
        ▼
[GET /async-operations?status=running,pending&tenantId=X&workspaceId=Y]
  (endpoint T02, paginado, multipage si >100 items)
        │
        ▼
[Reconciliar snapshot local vs respuesta]
  ├── operaciones nuevas → añadir al store
  ├── cambios de estado → actualizar store + notificar cambios terminales
  ├── operaciones ausentes del backend → marcar "no disponible" (purgada)
  └── sin cambios → no-op (idempotente)
        │
        ▼
[Emitir banner consolidado de cambios (si los hay)]
        │
        ▼
[Re-evaluar controles de acción: deshabilitar botones "Reintentar" en ops completadas/en-curso]
```

### 2.2 Componentes implicados

| Componente | Rol | Tarea previa |
|---|---|---|
| `useReconnectStateSync` (nuevo hook React) | Detecta online/visibilitychange, orquesta re-fetch y reconciliación | — |
| `reconcileOperations()` (util puro) | Lógica de diff local vs backend sin efectos secundarios | — |
| `OperationStatusBanner` (componente React) | Muestra resumen consolidado de cambios de estado tras reconexión | T02 (extensión) |
| `useOperationActions()` (hook existente T02) | Re-evalúa qué acciones están habilitadas post-reconexión | T02 (extensión) |
| `async-operation-query.mjs` (backend OpenWhisk) | Endpoint de consulta de progreso ya existente; no se modifica el contrato | T02 |
| Mecanismo de idempotency key | Reintentos post-reconexión lo usan directamente | T03 |

### 2.3 Límites claros

- **Sin cambios** a las acciones OpenWhisk de backend (T01–T04).
- **Sin DDL** nuevo: no se altera el schema PostgreSQL.
- **Sin nuevo endpoint**: se reutiliza el endpoint de consulta de T02 (`GET /async-operations`).
- La lógica de reconexión vive **exclusivamente en el frontend** (hook + util); el backend es agnóstico al concepto de "reconexión".

---

## 3. Cambios por Artefacto

### 3.1 Nuevo hook: `useReconnectStateSync`

**Ruta**: `console/src/hooks/use-reconnect-state-sync.js`

Responsabilidades:
- Suscribirse a `window.addEventListener('online', ...)` y `document.addEventListener('visibilitychange', ...)`.
- Al dispararse el evento, comprobar validez del token de sesión (Keycloak); si expirado, invocar `keycloak.updateToken()` / flujo de reautenticación.
- Invocar `fetchCurrentOperations(tenantId, workspaceId)` via el cliente API existente de T02.
- Llamar a `reconcileOperations(localSnapshot, remoteOps)` y despachar los deltas al store de estado (Redux / Zustand / Context, según patrón existente del proyecto).
- Exponer `{ isSyncing, lastSyncedAt, syncError }` al componente consumidor.

```js
// Contrato público del hook (tipado):
// useReconnectStateSync(options: {
//   tenantId: string,
//   workspaceId: string | null,
//   onStateChanged?: (delta: ReconciliationDelta) => void,
//   debounceMs?: number  // default 500
// }): { isSyncing: boolean, lastSyncedAt: Date | null, syncError: Error | null }
```

### 3.2 Utilidad pura: `reconcileOperations`

**Ruta**: `console/src/utils/reconcile-operations.js`

Recibe un snapshot local (`Map<operationId, Operation>`) y la lista remota (`Operation[]`).  
Devuelve un `ReconciliationDelta`:

```js
// ReconciliationDelta:
// {
//   updated: Operation[],      // estado cambió
//   added: Operation[],        // presentes en remoto, ausentes en local
//   terminal: Operation[],     // transitaron a completed|failed|timed_out|cancelled
//   unavailable: string[],     // operationIds presentes en local pero ausentes en remoto
//   unchanged: Operation[]     // sin cambios
// }
```

La función es **pura** (sin side-effects), lo que la hace trivialmente testeable con `node:test`.

### 3.3 Extensión de `OperationStatusBanner`

**Ruta**: `console/src/components/operations/OperationStatusBanner.jsx` (extensión de T02)

Comportamiento nuevo:
- Acepta prop `reconciliationDelta: ReconciliationDelta | null`.
- Si `delta.terminal.length > 0`, muestra un aviso consolidado agrupando terminales por estado: "2 operaciones completadas, 1 falló mientras estabas desconectado".
- Si `delta.unavailable.length > 0`, muestra "N operaciones ya no están disponibles (eliminadas o purgadas)".
- Se descarta manualmente o tras 30 s de inactividad.
- Respeta `aria-live="polite"` para accesibilidad.

### 3.4 Extensión de `useOperationActions`

**Ruta**: `console/src/hooks/use-operation-actions.js` (extensión de T02)

Cambio: al evaluar si un botón "Reintentar" está habilitado, consultar el estado **actual** del store (post-reconciliación) en lugar del snapshot local previo a la desconexión. Si la operación está en estado `running` o en un estado terminal que no soporta reintento (`completed`, `timed_out`, `cancelled`), el botón queda deshabilitado con tooltip explicativo.

### 3.5 Pruebas: unidad

**Ruta**: `tests/unit/reconcile-operations.test.mjs`

Cubre:
- Delta vacío cuando local === remoto.
- Detección de transición a estado terminal (`running → completed`, `running → failed`, etc.).
- Detección de operaciones añadidas (nuevas en remoto).
- Detección de operaciones no disponibles (ausentes en remoto).
- Corrección de tipos en `ReconciliationDelta`.
- Idempotencia: aplicar reconciliación dos veces con el mismo remoto produce el mismo delta.

**Ruta**: `tests/unit/use-reconnect-state-sync.test.mjs`

Cubre:
- Hook no dispara fetch si token expirado (dispara reautenticación en su lugar).
- Hook ignora eventos `visibilitychange` cuando `document.visibilityState !== 'visible'`.
- Hook aplica debounce: múltiples eventos rápidos producen un único fetch.
- `isSyncing` es `true` durante el fetch y `false` al completar.
- `syncError` se popula cuando el API devuelve error.

### 3.6 Pruebas: integración UI (React Testing Library)

**Ruta**: `tests/integration/reconnect-state-sync.test.jsx`

Cubre:
- Al disparar `window.online`, el componente consumidor muestra el banner con el delta correcto.
- Al reconectar con operaciones que transitaron a `failed`, el banner muestra la notificación consolidada.
- Al reconectar con operación `running → completed`, el botón "Reintentar" queda deshabilitado.
- Al reconectar con operación purgada, el elemento UI muestra estado "no disponible".
- Escenario multi-tenant: el mock del API solo devuelve operaciones del `tenantId` configurado en sesión.
- Token expirado: se muestra prompt de reautenticación antes de mostrar datos.

### 3.7 Pruebas: contrato API (relectura)

**Ruta**: `tests/contract/async-operation-query-reconnect.test.mjs`

Verifica que el endpoint `GET /async-operations` de T02 (invocado durante la relectura) cumpla el contrato esperado:
- Responde con `200` y array de operaciones del tenant autorizado.
- Filtra por `status=running,pending` cuando se solicita (parámetro de query).
- Devuelve `401` si el token ha expirado.
- Devuelve `403` si el tenant en query no coincide con el tenant del token.
- Soporta paginación (`page`, `pageSize`) para volúmenes altos.

### 3.8 Pruebas: seguridad multi-tenant

**Ruta**: `tests/integration/reconnect-tenant-isolation.test.mjs`

Escenarios:
- Actor de tenant A no recibe operaciones de tenant B en la relectura.
- Superadmin con permisos de supervisión de tenant A/B recibe operaciones de ambos si tiene claim adecuado.
- Token renovado con `workspace_id` reducido filtra operaciones del workspace ya no autorizado.

### 3.9 ADR

**Ruta**: `docs/adr/077-reconnect-job-state-reread.md`

Documenta:
- Decisión: relectura basada en polling/re-fetch en lugar de WebSocket/SSE (push) en esta fase.
- Decisión: lógica de reconciliación en frontend puro (sin endpoint dedicado de "diff").
- Decisión: banner consolidado vs. notificaciones individuales.
- Restricciones asumidas: backend agnóstico de reconexión; no requiere cambios en T01–T04.

---

## 4. Modelo de Datos, Eventos e Infraestructura

### 4.1 Sin cambios de schema

No hay DDL nuevo. El estado de las operaciones ya está en `async_operations` (T01) con estados terminales ampliados en T04.

### 4.2 Sin nuevos topics Kafka

La reconexión es un concepto del cliente. No se emiten eventos Kafka específicos de "reconexión"; los cambios de estado ya han sido publicados por T01–T04 en sus respectivos topics.

### 4.3 Variables de entorno / configuración

No se introducen nuevas variables de entorno. La URL base del API de consulta ya está configurada en T02.

### 4.4 Feature flags (recomendado)

Se recomienda introducir el flag `CONSOLE_RECONNECT_SYNC_ENABLED` (boolean, default `true`) para poder deshabilitar el comportamiento de re-fetch automático sin desplegar código, útil durante incidencias de backend.

---

## 5. Estrategia de Pruebas

| Nivel | Archivo | Qué valida |
|---|---|---|
| Unitario | `reconcile-operations.test.mjs` | Lógica de diff pura, todos los tipos de delta |
| Unitario | `use-reconnect-state-sync.test.mjs` | Hook: eventos, debounce, token expirado, estados internos |
| Integración UI | `reconnect-state-sync.test.jsx` | Comportamiento end-to-end del hook + UI con mocks del API |
| Integración UI | `reconnect-tenant-isolation.test.jsx` | Aislamiento tenant en el flujo de relectura |
| Contrato | `async-operation-query-reconnect.test.mjs` | Contrato del endpoint de consulta para el caso de relectura |

### 5.1 Herramientas

- `node:test` + `assert` (unit, contrato).
- React Testing Library + `jsdom` (integración UI).
- `msw` (Mock Service Worker) para interceptar peticiones del API en tests de integración UI sin servidor real.

### 5.2 Cobertura mínima esperada

- Todas las user stories del spec tienen al menos 1 test de integración UI.
- Todos los edge cases del spec tienen al menos 1 test unitario o de integración.
- La función `reconcileOperations` tiene cobertura de ramas ≥ 95%.

---

## 6. Riesgos, Compatibilidad y Observabilidad

### 6.1 Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| El endpoint de T02 no soporta filtrado por `status` múltiple | Media | Alto | Verificar contrato de T02 en Phase 0; si falta, añadir el parámetro como parte de T05 sin romper clientes existentes |
| Reconexión frecuente genera ráfaga de peticiones al API | Media | Medio | Debounce de 500 ms en el hook + feature flag para deshabilitar en caso de incidencia |
| Token expirado no detectado en tiempo real | Baja | Alto | Usar `keycloak.updateToken(30)` antes del re-fetch; si falla, redirigir al login |
| Volumen alto de operaciones históricas satura la UI al reconectar | Baja | Medio | Filtrar solo `status IN (running, pending)` en la relectura; operaciones terminales no se re-fetchen |

### 6.2 Rollback

- Sin DDL → rollback inmediato retirando el código del hook y el banner.
- Feature flag `CONSOLE_RECONNECT_SYNC_ENABLED=false` permite deshabilitar sin redeploy de código.

### 6.3 Observabilidad

- El hook registra en el logger de consola (nivel `debug`) cada evento de re-fetch: timestamp, número de operaciones reconciliadas, tipo de delta.
- `syncError` expuesto por el hook puede propagarse a Sentry / sistema de monitoreo de errores del frontend existente.
- Métrica recomendada (si el proyecto dispone de telemetría frontend): `console.reconnect.sync.duration_ms` y `console.reconnect.sync.delta_size`.

### 6.4 Seguridad

- El re-fetch siempre incluye el token de autenticación en curso; nunca usa tokens cacheados expirados.
- El `tenantId` y `workspaceId` de la petición de relectura se leen del contexto de sesión activo (post-token-refresh), no del estado local anterior a la desconexión.
- No se almacena en `localStorage` / `sessionStorage` ningún dato de operaciones; el estado local es únicamente en memoria.

---

## 7. Dependencias, Paralelización y Secuencia

### 7.1 Dependencias previas obligatorias

- **T01**: entidad `async_operation` y estados disponibles en el backend.
- **T02**: endpoint `GET /async-operations` y hook/componentes UI de seguimiento en consola.
- **T03**: idempotency key operativo (los reintentos post-reconexión lo consumen).
- **T04**: estados terminales `timed_out`, `cancelled` disponibles (la reconciliación los maneja).

### 7.2 Paralelización posible

- Los tests unitarios de `reconcileOperations` pueden desarrollarse **en paralelo** con los tests de integración UI, ya que `reconcileOperations` no depende del hook.
- El ADR puede redactarse en paralelo con el desarrollo del hook.

### 7.3 Secuencia recomendada

```text
1. Phase 0 — Verificar contrato real del endpoint T02 (filtrado por status, paginación)
2. Implementar reconcileOperations() + tests unitarios
3. Implementar useReconnectStateSync + tests unitarios del hook
4. Extender OperationStatusBanner + useOperationActions
5. Tests de integración UI (msw mocks)
6. Tests de contrato y multi-tenant
7. ADR
8. QA manual: flujo de reconexión en navegador contra backend T02 real
```

---

## 8. Criterios de Done y Evidencia Esperada

| Criterio | Evidencia |
|---|---|
| `reconcileOperations` implementada y exportada | Función en `console/src/utils/reconcile-operations.js`; tests unitarios pasan con cobertura ≥ 95% de ramas |
| `useReconnectStateSync` implementado | Hook en `console/src/hooks/use-reconnect-state-sync.js`; tests unitarios y de integración UI pasan |
| `OperationStatusBanner` muestra delta de reconexión | Test de integración UI muestra banner con resumen correcto tras simular `online` event |
| Botón "Reintentar" deshabilitado para ops en progreso/completadas post-reconexión | Test de integración UI verifica que el botón está `disabled` con `aria-disabled` y tooltip |
| Aislamiento tenant verificado | Tests de `reconnect-tenant-isolation.test.jsx` pasan; 0% de operaciones de tenant ajeno visibles |
| Reautenticación ante token expirado | Test unitario del hook verifica que no se hace re-fetch sin token válido |
| Edge cases cubiertos | Al menos 1 test por edge case listado en el spec |
| `pnpm test` en root pasa sin errores nuevos | CI verde (o evidencia de ejecución local sin regresiones) |
| ADR commiteado | `docs/adr/077-reconnect-job-state-reread.md` presente en el branch |
| Sin cambios en T01–T04 (backend invariante) | `git diff` no muestra modificaciones en `services/provisioning-orchestrator/src/` |
