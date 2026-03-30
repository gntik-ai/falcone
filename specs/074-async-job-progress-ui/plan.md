# Implementation Plan: Endpoints y Componentes UI para Progreso de Operaciones Asíncronas

**Branch**: `074-async-job-progress-ui` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-UIB-02-T02 | **Epic**: EP-16 | **Historia**: US-UIB-02
**Input**: Feature specification from `/specs/074-async-job-progress-ui/spec.md`

---

## Summary

Esta tarea añade la **capa de consulta pública** sobre el modelo de operaciones asíncronas establecido en T01: endpoints OpenWhisk para listar, detallar, obtener logs resumidos y resultado final de operaciones, más los componentes React de la consola que los consumen. Los datos viven en PostgreSQL (`async_operations`, `async_operation_transitions`); los logs resumidos se almacenan en la nueva tabla `async_operation_log_entries`. El contrato de consulta se expone como acción OpenWhisk con aislamiento multi-tenant y autorización RBAC vía Keycloak, replicando el patrón del `job-status.mjs` existente y el `authorization-model.json` del proyecto.

---

## Technical Context

**Language/Runtime**: Node.js 20+ ESM (backend OpenWhisk) · TypeScript + React 18 + Tailwind CSS + shadcn/ui (frontend consola)
**Primary Backend Deps**: `pg` (PostgreSQL), `kafkajs` (auditoría), OpenWhisk action runtime
**Frontend Deps**: React Router, `@tanstack/react-query` (polling), shadcn/ui primitives existentes
**Storage**: PostgreSQL (consultas) — ninguna tabla existente se modifica; se añade `async_operation_log_entries`
**Testing (backend)**: `node:test` + assertions · (frontend): Vitest + Testing Library
**Target Platform**: OpenWhisk sobre Kubernetes/OpenShift; consola React desplegada vía Nginx/container
**Performance Goals**: Listado de operaciones < 3 s p95; logs de operación < 5 s p95 (SC-001, SC-002)
**Constraints**: Sin endpoints HTTP propios (OpenWhisk actúa como backend); multi-tenancy estricto; secrets fuera del repo; logs orientados al usuario (no stack traces)
**Scale/Scope**: > 500 operaciones históricas por tenant sin degradación (SC-006)

---

## Constitution Check

*GATE: evaluado antes de Phase 0.*

| Principio | Verificación | Estado |
|-----------|-------------|--------|
| I — Monorepo SoC | Acción de consulta en `services/provisioning-orchestrator`; componentes UI en `apps/web-console`; contrato en `services/internal-contracts` | ✅ |
| II — Incremental Delivery | Solo consulta + UI; sin modificación de modelo de escritura ni reintentos | ✅ |
| III — K8s/OpenShift compat. | Sin security contexts propietarios; secrets vía env vars | ✅ |
| IV — Quality Gates at Root | Scripts de test añadidos a los paquetes; CI root los invoca con `pnpm -r test` | ✅ |
| V — Docs as Part of Change | ADR `074-async-job-progress-ui.md` incluido en el mismo commit | ✅ |
| Additional — pnpm workspaces | Uso de `pnpm` y workspace existente | ✅ |
| Additional — Secrets | Credenciales PG/Kafka no commitadas; sólo env vars | ✅ |

**Veredicto**: sin violaciones. No se requiere tabla de Complexity Tracking.

---

## Phase 0 — Research

### Decisión 1: Almacenamiento de logs resumidos

- **Decisión**: Nueva tabla `async_operation_log_entries` en PostgreSQL, alineada con el esquema de `async_operations`.
- **Rationale**: Los logs resumidos son datos estructurados con aislamiento tenant; PostgreSQL ya es la fuente de verdad del modelo de operaciones. MongoDB no aporta ventajas para este caso de uso tabular con consultas filtradas por tenant.
- **Alternativa rechazada**: MongoDB — rechazado porque el modelo ya usa PG para el ciclo de vida de operaciones; añadir un segundo store para logs crea inconsistencia operacional sin beneficio.

### Decisión 2: Patrón de consulta — OpenWhisk action vs. service layer

- **Decisión**: Una acción OpenWhisk `async-operation-query` que encapsula toda la lógica de consulta (listado, detalle, logs, resultado). El contrato de entrada usa un campo `queryType` para distinguir el modo.
- **Rationale**: El stack exige que la lógica backend compleja de la consola resida en OpenWhisk. Las acciones son wrappers delgados sobre módulos ESM puros reutilizables.
- **Alternativa rechazada**: Cuatro acciones separadas (una por tipo de consulta) — rechazado porque introduce overhead de despliegue sin ganancia funcional; el enrutamiento por `queryType` es suficiente.

### Decisión 3: Polling vs. WebSocket para indicador no bloqueante (US4)

- **Decisión**: Polling periódico con `@tanstack/react-query` (intervalo configurable, por defecto 15 s). Se detiene automáticamente cuando no hay operaciones activas.
- **Rationale**: La infraestructura no expone WebSocket nativo en OpenWhisk/APISIX para este caso; el polling es la opción más simple, mantenible y alineada con patrones existentes en la consola.
- **Alternativa rechazada**: Server-Sent Events o WebSocket — rechazados por requerir infraestructura adicional no justificada en este alcance.

### Decisión 4: Aislamiento tenant en queries

- **Decisión**: `tenant_id` se extrae del `callerContext` verificado por IAM (Keycloak), nunca del payload del cliente. Superadmin puede pasar `tenantId` en el payload para cross-tenant read, verificado por `actorType === 'superadmin'` en `callerContext`.
- **Rationale**: Consistente con la decisión de seguridad ya establecida en T01 y el `authorization-model.json` del proyecto.

### Decisión 5: Contrato de resultado final (`OperationResult`)

- **Decisión**: El resultado final se almacena en el campo `result` de `async_operations` (JSONB) para operaciones `completed` y en `error_summary` para `failed`. No se crea tabla adicional.
- **Rationale**: El modelo de T01 ya reserva estos campos. La acción de consulta los proyecta según el estado terminal de la operación.

---

## Phase 1 — Design & Contracts

### Nueva tabla: `async_operation_log_entries`

```sql
CREATE TABLE IF NOT EXISTS async_operation_log_entries (
  log_entry_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id   UUID        NOT NULL REFERENCES async_operations(operation_id) ON DELETE CASCADE,
  tenant_id      TEXT        NOT NULL,
  level          TEXT        NOT NULL DEFAULT 'info',
  -- enum: info | warning | error
  message        TEXT        NOT NULL,
  -- orientado al usuario; sin stack traces ni datos internos
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata       JSONB,
  -- reservado para contexto adicional estructurado
  CONSTRAINT async_op_log_entries_level_check
    CHECK (level IN ('info', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_async_op_log_entries_operation
  ON async_operation_log_entries(operation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_async_op_log_entries_tenant
  ON async_operation_log_entries(tenant_id);
```

**Nota**: La escritura de entradas de log es responsabilidad del workflow que ejecuta la operación (fuera del alcance de T02). Esta tarea solo expone la consulta.

---

### API Contract: Acción OpenWhisk `async-operation-query`

#### Input

```json
{
  "queryType": "list | detail | logs | result",
  "operationId": "<uuid — requerido para detail | logs | result>",
  "filters": {
    "status": "<pending|running|completed|failed — opcional para list>",
    "operationType": "<string — opcional para list>",
    "workspaceId": "<string — opcional para list>"
  },
  "pagination": {
    "limit": 20,
    "offset": 0
  }
}
```

`callerContext` se inyecta por el runtime OpenWhisk (no es parte del payload del cliente).

#### Output: `queryType = list`

```json
{
  "items": [
    {
      "operationId": "<uuid>",
      "status": "pending|running|completed|failed",
      "operationType": "<string>",
      "tenantId": "<string>",
      "workspaceId": "<string|null>",
      "actorId": "<string>",
      "actorType": "<string>",
      "createdAt": "<ISO8601>",
      "updatedAt": "<ISO8601>",
      "correlationId": "<string>"
    }
  ],
  "total": 42,
  "pagination": { "limit": 20, "offset": 0 }
}
```

#### Output: `queryType = detail`

```json
{
  "operationId": "<uuid>",
  "status": "pending|running|completed|failed",
  "operationType": "<string>",
  "tenantId": "<string>",
  "workspaceId": "<string|null>",
  "actorId": "<string>",
  "actorType": "<string>",
  "correlationId": "<string>",
  "idempotencyKey": "<string|null>",
  "sagaId": "<uuid|null>",
  "createdAt": "<ISO8601>",
  "updatedAt": "<ISO8601>",
  "errorSummary": "<{code, message, failedStep}|null>"
}
```

#### Output: `queryType = logs`

```json
{
  "operationId": "<uuid>",
  "entries": [
    {
      "logEntryId": "<uuid>",
      "level": "info|warning|error",
      "message": "<string — orientado al usuario>",
      "occurredAt": "<ISO8601>"
    }
  ],
  "total": 5,
  "pagination": { "limit": 20, "offset": 0 }
}
```

#### Output: `queryType = result`

```json
{
  "operationId": "<uuid>",
  "status": "completed|failed|running|pending",
  "resultType": "success|failure|pending",
  "summary": "<string|null>",
  "failureReason": "<string|null>",
  "retryable": "<boolean|null>",
  "completedAt": "<ISO8601|null>"
}
```

#### Error Codes

| Código | HTTP equiv. | Condición |
|--------|-------------|-----------|
| `NOT_FOUND` | 404 | Operación no existe o no pertenece al tenant |
| `FORBIDDEN` | 403 | Actor sin permisos sobre el recurso |
| `TENANT_ISOLATION_VIOLATION` | 403 | Intento de acceso cross-tenant sin ser superadmin |
| `VALIDATION_ERROR` | 400 | `queryType` inválido u operandos faltantes |
| `OPERATION_NOT_TERMINAL` | 409 | `queryType=result` sobre operación no terminal |

---

### Nuevo contrato JSON: `async-operation-query-response.json`

Archivo: `services/internal-contracts/src/async-operation-query-response.json`

Schema JSON-Schema Draft-07 que formaliza los cuatro outputs (list, detail, logs, result) mediante `oneOf` discriminado por `queryType`. Exportado desde `services/internal-contracts/src/index.mjs`.

---

### Estructura de archivos nuevos / modificados

```text
services/
  provisioning-orchestrator/
    src/
      repositories/
        async-operation-query-repo.mjs    # Queries de consulta (SELECT only) con tenant isolation
      actions/
        async-operation-query.mjs         # OpenWhisk action: consulta unificada
      migrations/
        074-async-operation-log-entries.sql  # DDL nueva tabla

  internal-contracts/
    src/
      async-operation-query-response.json  # Contrato output API de consulta
      index.mjs                            # Añadir export del nuevo contrato

apps/
  web-console/
    src/
      pages/
        ConsoleOperationsPage.tsx          # Vista listado de operaciones
        ConsoleOperationsPage.test.tsx
        ConsoleOperationDetailPage.tsx     # Vista detalle + logs + resultado
        ConsoleOperationDetailPage.test.tsx
      components/
        console/
          OperationStatusBadge.tsx         # Badge de estado (pending|running|completed|failed)
          OperationStatusBadge.test.tsx
          OperationLogEntriesList.tsx      # Lista de log entries paginada
          OperationLogEntriesList.test.tsx
          OperationResultSummary.tsx       # Resultado final (éxito o fallo)
          OperationResultSummary.test.tsx
          ActiveOperationsIndicator.tsx    # Indicador no bloqueante (badge con contador)
          ActiveOperationsIndicator.test.tsx
      lib/
        console-operations.ts              # API client: useOperations, useOperationDetail, useOperationLogs, useOperationResult
        console-operations.test.ts

tests/
  unit/
    async-operation-query-repo.test.mjs    # Tests de lógica de consulta (mocked DB)
  integration/
    async-operation-query-integration.test.mjs  # Tests contra PG de test
  contract/
    async-operation-query-response.test.mjs     # Valida outputs contra JSON Schema

docs/
  adr/
    074-async-job-progress-ui.md               # ADR: decisiones de esta tarea
```

---

## Phase 2 — Module Specifications

### `async-operation-query-repo.mjs`

Módulo ESM puro; sin efectos secundarios en import. Todas las funciones reciben `db` (pool PG) como primer argumento.

```js
// listOperations(db, { tenant_id, status?, operationType?, workspaceId?, limit, offset })
//   → { items: Operation[], total: number }
//   Filtro tenant_id obligatorio (nunca omitido). Superadmin puede pasar tenantId=null para all-tenants.
//
// getOperationById(db, { operation_id, tenant_id })
//   → Operation | null   (null = no existe o pertenece a otro tenant)
//
// getOperationLogs(db, { operation_id, tenant_id, limit, offset })
//   → { entries: LogEntry[], total: number }
//   Valida tenant_id antes de acceder a logs (join con async_operations).
//
// getOperationResult(db, { operation_id, tenant_id })
//   → { status, resultType, summary, failureReason, retryable, completedAt } | null
```

**Tenant isolation**: `listOperations`, `getOperationById`, `getOperationLogs` y `getOperationResult` siempre filtran por `tenant_id`. Si `tenant_id` es null y el contexto no es superadmin, se lanza `TENANT_ISOLATION_VIOLATION`.

**Paginación**: `limit` máximo 100, por defecto 20. `offset` por defecto 0.

**Índices utilizados**: `idx_async_ops_tenant_status` (listado), `idx_async_op_log_entries_operation` (logs).

---

### `async-operation-query.mjs` — OpenWhisk Action

```js
// Input: { queryType, operationId?, filters?, pagination?, callerContext }
// Flujo:
//   1. Extraer tenant_id y actorType de callerContext (IAM-verified; nunca del payload)
//   2. Validar queryType
//   3. Para queryType = detail | logs | result: validar operationId presente
//   4. Verificar autorización RBAC: tenant_owner y workspace_admin solo acceden a su tenant
//      Superadmin puede especificar tenantId en filters para cross-tenant read
//   5. Delegar a función correspondiente de async-operation-query-repo.mjs
//   6. Para queryType = result: si estado no terminal → retornar { resultType: 'pending' }
//   7. Escribir entrada de auditoría (async; no bloquea respuesta)
//   8. Retornar payload formateado
```

**Auditoría**: cada consulta produce un evento de auditoría con `actorId`, `tenantId`, `operationId` (si aplica), `queryType` y timestamp. Publicado en Kafka topic `console.async-operation.accessed` (best-effort, no bloquea respuesta).

---

### `console-operations.ts` — API Client React

Módulo TypeScript con hooks de React Query:

```ts
// useOperations(filters, pagination)
//   → { data: OperationList, isLoading, error, refetch }
//   Polling activo (refetchInterval: 30_000) si hay operaciones en estado running|pending
//
// useOperationDetail(operationId)
//   → { data: OperationDetail, isLoading, error }
//
// useOperationLogs(operationId, pagination)
//   → { data: OperationLogPage, isLoading, error }
//
// useOperationResult(operationId)
//   → { data: OperationResult, isLoading, error }
//
// useActiveOperationsCount()
//   → { count: number, isLoading }
//   Polling cada 15 s; retorna 0 cuando no hay operaciones activas → se detiene el intervalo
```

Todas las funciones encaminan las peticiones al gateway APISIX usando la función `http.ts` existente del proyecto con el token de sesión de Keycloak.

---

### Componentes React

**`OperationStatusBadge.tsx`**: Badge shadcn/ui coloreado por estado. `pending` → gris, `running` → azul animado, `completed` → verde, `failed` → rojo.

**`OperationLogEntriesList.tsx`**: Lista de `LogEntry` con nivel badge (info/warning/error), mensaje de usuario y timestamp relativo. Paginación client-side con `limit`/`offset`. Muestra estado vacío con mensaje cuando no hay entradas.

**`OperationResultSummary.tsx`**: Sección de resultado final. Para `completed`: resumen de lo aprovisionado. Para `failed`: motivo en lenguaje claro + indicador de reintentabilidad. Para estado no terminal: mensaje "La operación aún está en curso".

**`ActiveOperationsIndicator.tsx`**: Badge en el `ConsoleShellLayout` con contador de operaciones activas. Link a `/console/operations`. Se oculta si `count === 0`. Actualización por `useActiveOperationsCount`.

**`ConsoleOperationsPage.tsx`**: Vista listado con tabla de operaciones (columnas: tipo, estado badge, actor, workspace, fecha creación), filtros de estado/tipo, paginación, y link a detalle por fila.

**`ConsoleOperationDetailPage.tsx`**: Vista detalle que compone `OperationStatusBadge`, `OperationLogEntriesList` y `OperationResultSummary`. Ruta: `/console/operations/:operationId`.

---

### Rutas nuevas en `router.tsx`

```text
/console/operations                     → ConsoleOperationsPage (lazy)
/console/operations/:operationId        → ConsoleOperationDetailPage (lazy)
```

Ambas rutas protegidas con `ProtectedRoute` existente.

---

### Actualización de `ConsoleShellLayout.tsx`

- Añadir ítem de navegación "Operations" (icono: `Activity`) con ruta `/console/operations`.
- Montar `ActiveOperationsIndicator` en la barra superior.

---

## Testing Strategy

### Unit Tests (`tests/unit/`)

| Archivo | Cobertura |
|---------|-----------|
| `async-operation-query-repo.test.mjs` | `listOperations` con filtros; `getOperationById` con tenant correcto e incorrecto; `getOperationLogs` vacíos y con entradas; `getOperationResult` en estado terminal y no terminal; paginación |

### Integration Tests (`tests/integration/`)

| Archivo | Cobertura |
|---------|-----------|
| `async-operation-query-integration.test.mjs` | Consulta real contra PG de test; tenant isolation (actor de tenant A no puede ver tenant B); listado con > 100 operaciones (paginación); logs de operación por operation_id + tenant_id |

Requiere: instancia PostgreSQL de test. Migración `074-async-operation-log-entries.sql` aplicada antes de los tests.

### Contract Tests (`tests/contract/`)

| Archivo | Cobertura |
|---------|-----------|
| `async-operation-query-response.test.mjs` | Valida payload de `queryType=list`, `detail`, `logs` y `result` contra `async-operation-query-response.json` usando AJV |

### Frontend Tests (`apps/web-console/src/`)

| Archivo | Cobertura |
|---------|-----------|
| `OperationStatusBadge.test.tsx` | Renderiza color correcto para cada estado |
| `OperationLogEntriesList.test.tsx` | Lista entradas; estado vacío; paginación |
| `OperationResultSummary.test.tsx` | Éxito, fallo con reintentabilidad, estado no terminal |
| `ActiveOperationsIndicator.test.tsx` | Badge visible con count > 0; oculto con count = 0 |
| `ConsoleOperationsPage.test.tsx` | Renderiza listado con mock; filtros activos |
| `ConsoleOperationDetailPage.test.tsx` | Carga detalle + logs + resultado; maneja operación no encontrada |
| `console-operations.test.ts` | Hooks: polling activo con ops running; polling detenido sin ops activas |

### Acceptance Tests (criterios verificables en integración)

| ID | Escenario | Evidencia esperada |
|----|-----------|-------------------|
| AC-01 | Listar operaciones de tenant con filtro `status=running` | Solo operaciones del tenant en estado `running`; ninguna de otro tenant |
| AC-02 | Actor de tenant A consulta operación de tenant B | Error `TENANT_ISOLATION_VIOLATION` (403) |
| AC-03 | Superadmin consulta operación de cualquier tenant | Respuesta 200 con datos de la operación |
| AC-04 | Consultar logs de operación sin entradas | Respuesta con `entries: []` y mensaje informativo en UI |
| AC-05 | Consultar resultado de operación `completed` | `resultType: success`; `summary` presente |
| AC-06 | Consultar resultado de operación `running` | `resultType: pending`; sin error OPERATION_NOT_TERMINAL |
| AC-07 | Consultar resultado de operación `failed` | `resultType: failure`; `failureReason` presente; `retryable` boolean |
| AC-08 | Listado con 500 operaciones históricas | Respuesta < 3 s p95 con paginación activa |
| AC-09 | Indicador de operaciones activas en consola | Badge muestra count correcto; desaparece al terminar todas las ops |
| AC-10 | Auditoría generada por consulta | Evento en Kafka `console.async-operation.accessed` con actorId y tenantId |

---

## Migration Plan

Archivo: `services/provisioning-orchestrator/src/migrations/074-async-operation-log-entries.sql`

Contenido: DDL completo de `async_operation_log_entries` con índices (ver sección Data Model).

**Aplicación**: manual vía script de migración existente o CI job. `CREATE TABLE IF NOT EXISTS` → idempotente.

**Rollback**: `DROP TABLE IF EXISTS async_operation_log_entries;` — seguro en pre-producción; sin pérdida de datos de operaciones. Requiere aprobación en producción.

**Sin cambios** en tablas existentes (`async_operations`, `async_operation_transitions`).

---

## Risks, Observability & Security

### Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|-----------|
| Query lenta en listado con muchas operaciones históricas | Media | Índice compuesto `(tenant_id, status)` + paginación obligatoria; EXPLAIN ANALYZE en test de integración |
| `tenant_id` omitido en query por error de programación | Media | Lint rule + revisión de código; tests de aislamiento en CI; `async-operation-query-repo` lanza error si `tenant_id` es null sin contexto superadmin |
| Polling excesivo degrada backend | Baja | Intervalo mínimo 15 s en `useActiveOperationsCount`; polling deshabilitado si no hay ops activas; `staleTime` en React Query |
| Log entries con información técnica interna | Baja | Validación de `message` en repo antes de persistir: sin stack traces, sin datos de conexión; la UI solo muestra el campo `message` |
| Race condition entre transición de estado y consulta de resultado | Baja | `getOperationResult` para estado no terminal siempre retorna `resultType: pending` sin error; UI muestra estado actual |

### Observabilidad

- Métricas (Prometheus): `async_operation_query_total{queryType, tenant}`, `async_operation_query_duration_seconds{queryType}`, `async_operation_access_audit_publish_failures_total`
- Logs estructurados: cada invocación de la acción OW emite log JSON con `operation_id`, `tenant_id`, `actor_id`, `queryType`, `durationMs`
- Correlación: `correlation_id` de la operación propagado en respuesta y en el evento de auditoría

### Seguridad

- `tenant_id` extraído siempre del `callerContext` IAM-verificado; nunca del payload del cliente.
- `message` en log entries: no contiene stack traces, connection strings, datos PII internos. Validado en capa de repositorio.
- Cross-tenant read solo para `actorType === 'superadmin'` en `callerContext`.
- Auditoría de accesos: cada consulta genera evento Kafka `console.async-operation.accessed` con actor, tenant, recurso y timestamp.
- Token de sesión Keycloak validado por APISIX antes de llegar a la acción OW.

---

## Dependencies & Sequencing

### Prerequisitos externos

- **US-UIB-02-T01** (modelo de operaciones): tablas `async_operations` y `async_operation_transitions` ya existentes; módulos `async-operation-repo.mjs`, `async-operation-states.mjs`, `async-operation.mjs` disponibles.
- **US-UIB-01** (IAM/Keycloak): provee `callerContext` con `tenant_id` y `actor_id` verificados.

### Secuencia de implementación recomendada

```text
1. DDL migration 074-async-operation-log-entries.sql
2. async-operation-query-repo.mjs + unit tests
3. async-operation-query.mjs (OW action) + contract tests
4. async-operation-query-response.json + export en internal-contracts/index.mjs
5. console-operations.ts (hooks React Query) + tests
6. OperationStatusBadge + OperationLogEntriesList + OperationResultSummary (componentes atómicos) + tests
7. ConsoleOperationsPage + ConsoleOperationDetailPage + tests
8. ActiveOperationsIndicator + integración en ConsoleShellLayout + tests
9. Rutas nuevas en router.tsx
10. Integration tests (requieren PG de test)
11. docs/adr/074-async-job-progress-ui.md
12. Update AGENTS.md
```

Pasos 2–4 (backend) paralelizables con paso 5 (hooks frontend) si hay dos revisores.
Pasos 6–9 (componentes UI) paralelizables entre sí una vez que paso 5 está estable.

### Dependencias de tareas siguientes

- **T03** (reintentos + idempotencia): puede reutilizar `async-operation-query-repo.mjs` para verificar estado antes de reintentar.
- **T05** (pruebas de reconexión): se apoya en los componentes UI de esta tarea y en el manejo de errores de red en `console-operations.ts`.

---

## Criteria of Done

| ID | Criterio | Evidencia |
|----|----------|-----------|
| DOD-01 | Tabla `async_operation_log_entries` existe en DB con todos los índices | `\d+ async_operation_log_entries` en psql |
| DOD-02 | Acción OW `async-operation-query` ejecuta sin error con los 4 queryTypes | `wsk action invoke` con payload válido retorna 200 con campos esperados |
| DOD-03 | Tenant isolation verificado: actor tenant A no accede a operaciones tenant B | Test integración AC-02 pasa |
| DOD-04 | Superadmin cross-tenant read funciona | Test integración AC-03 pasa |
| DOD-05 | Contract tests de todos los queryTypes pasan con AJV | `pnpm -r test` verde en `tests/contract/` |
| DOD-06 | `ConsoleOperationsPage` renderiza listado con datos mocked | Test Vitest + Testing Library verde |
| DOD-07 | `ConsoleOperationDetailPage` renderiza detalle + logs + resultado | Test Vitest + Testing Library verde |
| DOD-08 | `ActiveOperationsIndicator` muestra count correcto y se oculta con 0 | Test componente verde; verificado en consola |
| DOD-09 | Rutas `/console/operations` y `/console/operations/:operationId` accesibles | Test router + navegación manual en dev |
| DOD-10 | SC-001: listado < 3 s p95 con 500 operaciones | Medido en test de integración |
| DOD-11 | SC-002: logs < 5 s p95 | Medido en test de integración |
| DOD-12 | SC-003: 100% aislamiento tenant | Tests de integración cubren AC-01, AC-02 |
| DOD-13 | SC-004: indicador de operaciones activas se actualiza sin recarga | Verificado en dev y test de componente |
| DOD-14 | SC-006: 500 operaciones históricas sin degradación perceptible | Test DOD-10 |
| DOD-15 | Auditoría de accesos generada | Evento Kafka `console.async-operation.accessed` verificado en contract test |
| DOD-16 | `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` pasan en CI | Pipeline CI verde |
| DOD-17 | ADR `074-async-job-progress-ui.md` commit junto al código | Presente en `docs/adr/` en el mismo PR |

---

*Plan generado por `/speckit.plan` — US-UIB-02-T02 — 2026-03-30*
