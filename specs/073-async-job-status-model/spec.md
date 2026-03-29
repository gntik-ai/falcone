# Feature Specification: Modelo de Job/Operation Status para Workflows Asíncronos

**Feature Branch**: `073-async-job-status-model`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Implementar modelo de job/operation status para workflows asíncronos iniciados desde consola o API."

**Backlog Traceability**:
- Task ID: US-UIB-02-T01
- Epic: EP-16 — Backend funcional de la consola
- Historia: US-UIB-02 — Estado asíncrono, reintentos e idempotencia de aprovisionamientos administrativos
- RF cubiertos: RF-UIB-006, RF-UIB-007, RF-UIB-008
- Dependencias: US-UIB-01

## Objetivo y Problema que Resuelve

Actualmente, cuando un actor administrativo (tenant owner, workspace admin o superadmin) inicia una operación de aprovisionamiento desde la consola o la API — por ejemplo, crear un workspace, habilitar un servicio, o configurar recursos — la plataforma no dispone de un modelo explícito para representar el ciclo de vida de esa operación. El resultado es que:

1. **Operaciones opacas**: el solicitante no tiene visibilidad sobre si una operación larga sigue en curso, ha fallado silenciosamente o ha terminado con éxito.
2. **Bloqueo del usuario**: sin un modelo de estado, la consola no puede desacoplar el inicio de una operación de su resolución, lo que obliga a esperas síncronas o a asumir éxito sin confirmación.
3. **Base ausente para reintentos e idempotencia**: sin un registro formal de operaciones, las tareas hermanas (T02–T06) no pueden implementar consulta de progreso, reintentos seguros ni políticas de recuperación.

Esta tarea establece el **modelo fundacional de job/operation status**: una representación lógica del ciclo de vida de cualquier operación asíncrona iniciada desde la consola o API, incluyendo sus estados, transiciones válidas, metadatos mínimos y reglas de aislamiento multi-tenant.

## Usuarios y Consumidores Afectados

| Actor | Tipo | Valor que recibe |
| ----- | ---- | ---------------- |
| Tenant Owner | Externo | Visibilidad sobre operaciones de aprovisionamiento de su tenant; confianza en que las operaciones no se pierden |
| Workspace Admin | Externo | Capacidad de verificar el estado de operaciones sobre recursos de su workspace |
| Superadmin | Interno | Vista transversal de operaciones en curso o fallidas en cualquier tenant, para soporte y gobernanza |
| Console Backend | Interno (sistema) | Modelo estructurado para crear, actualizar y consultar el estado de operaciones; base para endpoints futuros (T02) |
| Motor de Reintentos (futuro, T03) | Interno (sistema) | Registro de operaciones sobre el que aplicar lógica de reintento e idempotencia |

## User Scenarios & Testing

### User Story 1 — Registro de operación asíncrona al iniciar un aprovisionamiento (Priority: P1)

Cuando el console backend o la API inicia una operación de aprovisionamiento (e.g., crear workspace, habilitar servicio), el sistema crea automáticamente un registro de job/operation con estado inicial, asociándolo al tenant, al actor solicitante y a la operación concreta.

**Why this priority**: Sin este registro no existe el modelo; es el cimiento de toda la historia US-UIB-02.

**Independent Test**: Se puede verificar invocando la creación de una operación y comprobando que el registro existe con los campos mínimos requeridos y en estado `pending`.

**Acceptance Scenarios**:

1. **Given** un tenant owner autenticado inicia un aprovisionamiento, **When** el backend procesa la solicitud, **Then** se crea un registro de operación con estado `pending`, timestamp de creación, identificador único, tenant_id, actor_id, tipo de operación y workspace_id (si aplica).
2. **Given** un workspace admin inicia una operación sobre un workspace, **When** el registro se crea, **Then** el workspace_id se asocia correctamente y el registro es visible solo para actores autorizados del mismo tenant.
3. **Given** una solicitud de aprovisionamiento sin tenant_id o actor_id válido, **When** se intenta crear el registro, **Then** la operación es rechazada y no se crea ningún job.

---

### User Story 2 — Transiciones de estado del ciclo de vida de una operación (Priority: P1)

Una vez creada la operación, el sistema permite transiciones de estado según un ciclo de vida definido. Los estados y transiciones válidos son explícitos y verificables.

**Why this priority**: El modelo de estados es inseparable del registro; sin transiciones definidas, el registro es un dato inerte.

**Independent Test**: Se puede verificar creando una operación y ejecutando transiciones válidas e inválidas, comprobando que solo las transiciones permitidas se aplican.

**Acceptance Scenarios**:

1. **Given** una operación en estado `pending`, **When** el procesador comienza a ejecutarla, **Then** el estado transiciona a `running` y se registra el timestamp de inicio.
2. **Given** una operación en estado `running`, **When** la operación completa exitosamente, **Then** el estado transiciona a `completed` con timestamp de finalización.
3. **Given** una operación en estado `running`, **When** la operación falla, **Then** el estado transiciona a `failed` con timestamp de fallo y un campo de motivo/error resumido.
4. **Given** una operación en estado `completed` o `failed`, **When** se intenta transicionar a `running`, **Then** la transición es rechazada (estados terminales son inmutables).
5. **Given** una operación en cualquier estado, **When** se intenta una transición no definida en el ciclo de vida, **Then** la transición es rechazada con error descriptivo.

---

### User Story 3 — Aislamiento multi-tenant de operaciones (Priority: P1)

Los registros de operaciones están estrictamente aislados por tenant. Ningún actor puede ver, modificar o consultar operaciones de un tenant distinto al suyo, salvo el superadmin.

**Why this priority**: El aislamiento multi-tenant es un requisito transversal P0 del producto; sin él, el modelo no es desplegable.

**Independent Test**: Se puede verificar creando operaciones en dos tenants distintos y comprobando que las consultas desde cada tenant solo retornan sus propios registros.

**Acceptance Scenarios**:

1. **Given** operaciones registradas para tenant A y tenant B, **When** un actor de tenant A consulta operaciones, **Then** solo ve operaciones de tenant A.
2. **Given** un superadmin autenticado, **When** consulta operaciones sin filtro de tenant, **Then** puede ver operaciones de cualquier tenant.
3. **Given** un actor de tenant A, **When** intenta acceder directamente a una operación de tenant B por su identificador, **Then** recibe un error de acceso denegado o recurso no encontrado.

---

### User Story 4 — Metadatos mínimos y trazabilidad de cada operación (Priority: P2)

Cada registro de operación incluye metadatos suficientes para trazabilidad, auditoría y correlación futura con logs y eventos.

**Why this priority**: Habilita la auditoría y correlación, pero no bloquea las funcionalidades P1 si se entrega con campos básicos.

**Independent Test**: Se puede verificar inspeccionando un registro de operación creado y comprobando la presencia de todos los campos requeridos.

**Acceptance Scenarios**:

1. **Given** una operación registrada, **When** se consulta su detalle, **Then** contiene como mínimo: id único, tenant_id, actor_id, workspace_id (nullable), tipo de operación, estado actual, timestamps (creación, última actualización), y un campo de correlation_id para trazabilidad distribuida.
2. **Given** una operación que transiciona de estado, **When** se consulta después de la transición, **Then** el timestamp de última actualización refleja el momento de la transición.
3. **Given** una operación fallida, **When** se consulta su detalle, **Then** incluye un campo `error_summary` con texto legible que describe el motivo del fallo (sin exponer datos sensibles).

---

### Edge Cases

- ¿Qué ocurre si se intenta crear dos operaciones idénticas simultáneamente para el mismo recurso? → El modelo registra ambas como operaciones independientes; la deduplicación por idempotency key es responsabilidad de T03.
- ¿Qué ocurre si el sistema falla entre la creación del registro y el inicio del procesamiento? → La operación queda en estado `pending` indefinidamente; las políticas de timeout y recuperación son responsabilidad de T04.
- ¿Qué ocurre si un actor es eliminado del tenant mientras tiene operaciones en curso? → Las operaciones en curso continúan; el actor_id se preserva como dato histórico. La consulta posterior dependerá de la lógica de permisos (fuera de alcance de esta tarea).
- ¿Qué ocurre si el tenant es desactivado con operaciones `running`? → Las operaciones en curso deben poder transicionar a `failed` con motivo "tenant deactivated". La política de desactivación es gobernada por el módulo de tenant lifecycle (fuera de alcance).

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE crear un registro de operación con estado inicial `pending` cada vez que se inicia un workflow de aprovisionamiento desde la consola o API.
- **FR-002**: Cada registro de operación DEBE contener como mínimo: id único (generado por el sistema), tenant_id, actor_id, workspace_id (nullable), operation_type, status, created_at, updated_at, y correlation_id.
- **FR-003**: El sistema DEBE definir un ciclo de vida de estados con las siguientes transiciones válidas: `pending` → `running`, `running` → `completed`, `running` → `failed`. Los estados `completed` y `failed` son terminales.
- **FR-004**: El sistema DEBE rechazar cualquier transición de estado no incluida en el ciclo de vida definido, retornando un error descriptivo.
- **FR-005**: El sistema DEBE garantizar aislamiento multi-tenant: las operaciones de un tenant no son visibles ni accesibles para actores de otro tenant.
- **FR-006**: El superadmin DEBE poder consultar operaciones de cualquier tenant.
- **FR-007**: El sistema DEBE registrar un timestamp de última actualización (`updated_at`) en cada transición de estado.
- **FR-008**: Cuando una operación transiciona a `failed`, el sistema DEBE almacenar un campo `error_summary` con texto legible que no exponga datos sensibles del sistema.
- **FR-009**: El sistema DEBE rechazar la creación de un registro de operación si no se proporciona tenant_id o actor_id válidos.
- **FR-010**: El sistema DEBE generar un `correlation_id` para cada operación que permita correlacionar trazas distribuidas en logs y eventos.
- **FR-011**: Cada cambio de estado de una operación DEBE generar un evento auditable que incluya operation_id, estado anterior, estado nuevo, actor_id, tenant_id y timestamp.

### Key Entities

- **Operation (Job)**: Representa una operación asíncrona de aprovisionamiento. Atributos principales: id, tenant_id, actor_id, workspace_id, operation_type, status, error_summary, correlation_id, created_at, updated_at. Los estados posibles forman un ciclo de vida finito: pending → running → completed|failed.
- **Operation State Transition**: Evento que representa un cambio de estado en una operación. Contiene: operation_id, previous_status, new_status, actor_id, tenant_id, timestamp. Sirve como registro auditable del ciclo de vida.

## Success Criteria

### Measurable Outcomes

- **SC-001**: El 100% de las operaciones de aprovisionamiento iniciadas desde la consola o API generan un registro de operación consultable en menos de 2 segundos tras el inicio.
- **SC-002**: Las transiciones de estado inválidas son rechazadas el 100% de las veces sin corromper el estado de la operación.
- **SC-003**: Un actor de un tenant no puede acceder a operaciones de otro tenant en el 100% de los intentos (verificado mediante pruebas de aislamiento).
- **SC-004**: Cada transición de estado produce un evento auditable que puede ser consultado para el 100% de las operaciones registradas.
- **SC-005**: Los campos de trazabilidad (correlation_id, timestamps, actor_id) están presentes y correctos en el 100% de los registros de operación.

## Assumptions

- El módulo de autenticación y autorización (IAM/Keycloak) ya proporciona tenant_id y actor_id verificados al backend de consola (dependencia US-UIB-01).
- El bus de eventos (Kafka) está disponible para publicar eventos de cambio de estado, pero la suscripción y consumo de esos eventos por otros módulos está fuera de alcance.
- El almacenamiento persistente (PostgreSQL) está disponible para el registro de operaciones.
- El ciclo de vida de estados definido (`pending` → `running` → `completed`|`failed`) es suficiente para esta tarea; extensiones como `cancelled` o `retrying` se abordarán en T03/T04.
- El correlation_id se genera internamente; la propagación de trace context desde el API Gateway es un supuesto cubierto por la infraestructura de observabilidad existente.

## Out of Scope

- Endpoints de consulta de progreso o resultado (T02).
- Lógica de reintentos e idempotencia (T03).
- Políticas de timeout, cancelación y recuperación (T04).
- Pruebas de reconexión de consola (T05).
- Documentación de semántica de reintento (T06).
- UI/UX de visualización de operaciones en la consola.
- Notificaciones push o realtime al usuario sobre cambios de estado.
