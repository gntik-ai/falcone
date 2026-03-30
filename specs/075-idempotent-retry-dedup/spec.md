# Feature Specification: Reintentos Idempotentes con Deduplicación por Idempotency Key

**Feature Branch**: `075-idempotent-retry-dedup`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Reintentos idempotentes con deduplicación por idempotency key"

**Backlog Traceability**:
- Task ID: US-UIB-02-T03
- Epic: EP-16 — Backend funcional de la consola
- Historia: US-UIB-02 — Estado asíncrono, reintentos e idempotencia de aprovisionamientos administrativos
- RF cubiertos: RF-UIB-006, RF-UIB-007, RF-UIB-008
- Dependencias declaradas de la historia: US-UIB-01
- Dependencias dentro de la historia: US-UIB-02-T01 (modelo de operation status), US-UIB-02-T02 (endpoints de consulta de progreso)

## Objetivo y Problema que Resuelve

Las operaciones de aprovisionamiento de la plataforma BaaS (crear workspace, habilitar servicio, configurar recursos) son inherentemente asíncronas y pueden fallar por motivos transitorios (timeouts de red, indisponibilidad temporal de un servicio downstream, fallos intermitentes de infraestructura). Actualmente, tras el establecimiento del modelo de operaciones asíncronas (T01) y los endpoints de consulta de progreso (T02), la plataforma carece de un mecanismo para:

1. **Prevenir duplicidades por reintentos del cliente**: si un actor administrativo o la propia consola reenvía una solicitud de aprovisionamiento (por timeout de red, recarga de página o reintento manual), el sistema crea una operación duplicada, provocando efectos secundarios no deseados (recursos duplicados, consumo doble de cuota, inconsistencia).
2. **Reintentar operaciones fallidas de forma segura**: cuando una operación termina en estado `failed` por causas transitorias, no existe una forma estandarizada de solicitar un reintento que reutilice el contexto original sin volver a ejecutar pasos ya completados ni crear un registro nuevo desvinculado del original.
3. **Garantizar idempotencia verificable**: los consumidores internos (console backend, motor de workflows) y externos (API pública) necesitan una semántica clara de "misma solicitud → mismo resultado" para operar con confianza sobre procesos largos.

Esta tarea introduce la **idempotency key como mecanismo de deduplicación** y el **reintento seguro de operaciones fallidas**, extendiendo el modelo de operaciones de T01 con las capacidades necesarias para que la consola y la API puedan reintentar sin riesgo.

## Usuarios y Consumidores Afectados

| Actor | Tipo | Valor que recibe |
| ----- | ---- | ---------------- |
| Tenant Owner | Externo | Puede reintentar aprovisionamientos fallidos desde la consola con confianza de que no se generan duplicados ni efectos colaterales |
| Workspace Admin | Externo | Las operaciones sobre su workspace son seguras frente a reintentos accidentales (doble clic, recarga de página, reenvío de formulario) |
| Superadmin | Interno | Puede reintentar operaciones fallidas de cualquier tenant desde herramientas de soporte sin riesgo de duplicación |
| Console Backend | Interno (sistema) | Dispone de semántica de idempotency key para deduplicar solicitudes antes de crear nuevas operaciones |
| API Pública | Interno (sistema) | Los consumidores de la API pueden enviar idempotency keys y recibir respuestas consistentes ante reintentos |
| Motor de Workflows (futuro) | Interno (sistema) | Puede invocar pasos de aprovisionamiento con garantía de idempotencia, habilitando lógica de retry automática |

## User Scenarios & Testing

### User Story 1 — Deduplicación de solicitudes por idempotency key (Priority: P1)

Cuando un actor o sistema envía una solicitud de aprovisionamiento con una idempotency key que ya fue procesada dentro de la ventana de validez, el sistema retorna la operación existente en lugar de crear una nueva. Esto protege contra duplicados causados por reintentos de red, doble clic en la consola o reenvío de formularios.

**Why this priority**: Es el mecanismo fundacional que elimina el riesgo de duplicación. Sin él, todo reintento (manual o automático) puede producir efectos secundarios no deseados.

**Independent Test**: Se puede verificar enviando dos solicitudes con la misma idempotency key y comprobando que solo se crea una operación, y que la segunda solicitud retorna la operación existente.

**Acceptance Scenarios**:

1. **Given** un tenant owner envía una solicitud de aprovisionamiento con idempotency key `IK-abc123`, **When** la solicitud se procesa por primera vez, **Then** se crea una operación nueva y se asocia la idempotency key a esa operación; se retorna la operación creada.
2. **Given** una operación ya existe con idempotency key `IK-abc123` para el mismo tenant, **When** se envía una nueva solicitud con la misma idempotency key, el mismo tipo de operación y los mismos parámetros, **Then** el sistema retorna la operación existente sin crear una nueva ni modificar su estado.
3. **Given** una operación asociada a idempotency key `IK-abc123` para tenant A, **When** un actor de tenant B envía una solicitud con la misma idempotency key, **Then** se crea una operación nueva para tenant B (las idempotency keys están scoped por tenant).
4. **Given** una solicitud con idempotency key `IK-abc123` y tipo de operación `create-workspace`, **When** se envía otra solicitud con la misma idempotency key pero tipo de operación diferente (`enable-service`), **Then** el sistema rechaza la solicitud con un error de conflicto de idempotency key, indicando que la key ya está asociada a una operación de tipo distinto.

---

### User Story 2 — Reintento seguro de operaciones fallidas (Priority: P1)

Cuando una operación ha alcanzado el estado terminal `failed` por causas transitorias, el actor autorizado puede solicitar un reintento. El sistema crea un nuevo intento vinculado a la operación original, reutilizando el contexto (parámetros, tenant, workspace) sin exigir al usuario reintroducir datos.

**Why this priority**: El reintento seguro es la segunda mitad de la promesa de idempotencia; sin él, los fallos transitorios requieren intervención manual completa.

**Independent Test**: Se puede verificar marcando una operación como `failed`, solicitando un reintento y comprobando que se crea un nuevo intento con los parámetros originales y estado `pending`.

**Acceptance Scenarios**:

1. **Given** una operación en estado `failed`, **When** el actor autorizado solicita un reintento, **Then** el sistema crea un nuevo intento de ejecución vinculado a la operación original, con estado `pending`, preservando los parámetros originales y generando un nuevo correlation_id.
2. **Given** una operación en estado `failed`, **When** se solicita reintento, **Then** se incrementa un contador de intentos en la operación y se registra un evento auditable de reintento con actor_id, timestamp y número de intento.
3. **Given** una operación en estado `running` o `completed`, **When** se solicita un reintento, **Then** el sistema rechaza la solicitud con error descriptivo (solo se pueden reintentar operaciones en estado `failed`).
4. **Given** una operación en estado `failed` que ya ha alcanzado el límite máximo de reintentos configurado para su tipo de operación, **When** se solicita un reintento, **Then** el sistema rechaza la solicitud indicando que se ha alcanzado el límite y se requiere intervención manual.
5. **Given** una operación en estado `failed` de tenant A, **When** un actor de tenant B solicita reintentar, **Then** la solicitud es rechazada (aislamiento multi-tenant).

---

### User Story 3 — Expiración de idempotency keys (Priority: P2)

Las idempotency keys tienen una ventana de validez temporal. Una vez expirada la ventana, una solicitud con la misma key se trata como nueva, permitiendo que el mismo actor reutilice keys tras un período razonable.

**Why this priority**: Evita acumulación indefinida de keys y permite reutilización legítima de identificadores. No bloquea los flujos P1 porque la ventana por defecto es suficientemente amplia para los casos de uso principales.

**Independent Test**: Se puede verificar creando una operación con idempotency key, avanzando el tiempo más allá de la ventana de validez, y confirmando que una nueva solicitud con la misma key crea una operación nueva.

**Acceptance Scenarios**:

1. **Given** una operación creada con idempotency key `IK-xyz789` hace más tiempo que la ventana de validez configurada, **When** se envía una nueva solicitud con la misma key, **Then** el sistema la trata como solicitud nueva y crea una operación independiente.
2. **Given** una operación creada con idempotency key `IK-xyz789` dentro de la ventana de validez, **When** se envía una solicitud con la misma key, **Then** el sistema retorna la operación existente (deduplicación activa).

---

### User Story 4 — Auditoría y trazabilidad de reintentos (Priority: P2)

Cada reintento y cada deduplicación producen registros auditables que permiten al superadmin y a los sistemas de observabilidad reconstruir la secuencia de intentos de una operación.

**Why this priority**: Necesario para gobernanza y diagnóstico, pero la operativa funcional de reintentos (P1) no depende de que la auditoría esté completa.

**Independent Test**: Se puede verificar ejecutando una secuencia de solicitud original + deduplicación + reintento y comprobando que existen eventos auditables para cada interacción.

**Acceptance Scenarios**:

1. **Given** una solicitud deduplicada (misma idempotency key), **When** el sistema retorna la operación existente, **Then** se genera un evento auditable de tipo "deduplication" que incluye idempotency_key, operation_id, actor_id, tenant_id y timestamp.
2. **Given** un reintento de operación fallida, **When** se crea el nuevo intento, **Then** se genera un evento auditable de tipo "retry" que incluye operation_id, attempt_number, actor_id, tenant_id, correlation_id original y nuevo correlation_id.
3. **Given** un superadmin consulta el historial de una operación, **When** solicita la traza de intentos, **Then** puede ver la secuencia completa: solicitud original, deduplicaciones rechazadas y reintentos con sus resultados.

---

### Edge Cases

- **Solicitud concurrente con misma idempotency key**: si dos solicitudes con la misma key llegan simultáneamente, solo una debe crear la operación; la otra debe recibir la operación recién creada o un error transitorio que invite a reintentar. No se deben crear dos operaciones.
- **Idempotency key vacía o ausente**: las solicitudes sin idempotency key se procesan normalmente sin deduplicación; el sistema crea una operación nueva en cada caso. La idempotency key es opcional para compatibilidad hacia atrás.
- **Cambio de parámetros con misma idempotency key**: si se envía la misma idempotency key con parámetros distintos (pero mismo tipo de operación), el sistema retorna la operación existente junto con una indicación de que los parámetros enviados no coinciden con los originales (warning), sin modificar la operación.
- **Reintento de operación con dependencias externas irrecuperables**: si la causa del fallo no es transitoria (p. ej. recurso upstream eliminado permanentemente), el reintento fallará de nuevo. Este diagnóstico no es responsabilidad de T03; las políticas de recuperación corresponden a T04.
- **Reintento de operación cuyo tenant ha sido desactivado**: el reintento debe fallar inmediatamente con error descriptivo sin ejecutar pasos del workflow.
- **Formato y longitud de idempotency key**: la key debe ser una cadena opaca con límites de longitud razonables. Keys que excedan el límite o contengan caracteres no válidos deben ser rechazadas con error descriptivo.

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE aceptar una idempotency key opcional en cada solicitud de inicio de operación de aprovisionamiento. La key es una cadena opaca proporcionada por el cliente.
- **FR-002**: Cuando se recibe una solicitud con idempotency key que ya está asociada a una operación existente del mismo tenant y del mismo tipo de operación, el sistema DEBE retornar la operación existente sin crear una nueva.
- **FR-003**: Las idempotency keys DEBEN estar scoped por tenant. Una misma key en tenants distintos se trata como independiente.
- **FR-004**: Si se recibe una solicitud con una idempotency key ya asociada a una operación de tipo diferente (dentro del mismo tenant), el sistema DEBE rechazar la solicitud con un error de conflicto.
- **FR-005**: Si se recibe una solicitud deduplicada (misma key, mismo tipo) pero con parámetros distintos a los de la operación original, el sistema DEBE retornar la operación existente acompañada de un indicador de discrepancia de parámetros.
- **FR-006**: Las solicitudes sin idempotency key DEBEN procesarse normalmente, creando una operación nueva cada vez (compatibilidad hacia atrás).
- **FR-007**: El sistema DEBE garantizar que en caso de solicitudes concurrentes con la misma idempotency key, solo se cree una operación. La resolución de concurrencia debe evitar duplicados.
- **FR-008**: Las idempotency keys DEBEN tener una ventana de validez temporal configurable por el sistema. Una vez expirada, la key puede ser reutilizada y una nueva solicitud con la misma key crea una operación independiente.
- **FR-009**: El sistema DEBE permitir solicitar el reintento de una operación en estado `failed`, creando un nuevo intento de ejecución vinculado a la operación original con estado `pending`.
- **FR-010**: El reintento DEBE preservar los parámetros originales de la operación, sin requerir que el solicitante los reintroduzca.
- **FR-011**: El sistema DEBE mantener un contador de intentos por operación y rechazar reintentos que excedan el límite máximo configurable para el tipo de operación.
- **FR-012**: Solo se DEBEN permitir reintentos de operaciones en estado `failed`. Los reintentos de operaciones en estados `pending`, `running` o `completed` DEBEN ser rechazados con error descriptivo.
- **FR-013**: Cada reintento DEBE generar un nuevo correlation_id para trazabilidad independiente del intento.
- **FR-014**: El sistema DEBE aplicar aislamiento multi-tenant en reintentos: un actor solo puede reintentar operaciones de su propio tenant (salvo superadmin).
- **FR-015**: La idempotency key DEBE tener límites de longitud y formato definidos. Keys que excedan los límites o contengan caracteres no válidos DEBEN ser rechazadas.
- **FR-016**: Cada deduplicación exitosa DEBE generar un evento auditable que incluya idempotency_key, operation_id, actor_id, tenant_id y timestamp.
- **FR-017**: Cada reintento DEBE generar un evento auditable que incluya operation_id, attempt_number, actor_id, tenant_id, correlation_id previo y nuevo correlation_id.
- **FR-018**: El superadmin DEBE poder reintentar operaciones fallidas de cualquier tenant.

### Key Entities

- **Idempotency Key Record**: Representa la asociación entre una idempotency key y una operación existente. Atributos principales: idempotency_key, tenant_id, operation_id, operation_type, parámetros_hash (para detección de discrepancia), created_at, expires_at. El registro permite la búsqueda rápida por (tenant_id, idempotency_key) para deduplicación.
- **Retry Attempt**: Representa un intento de ejecución de una operación. Atributos principales: attempt_id, operation_id, attempt_number, correlation_id, status, created_at, completed_at. Vinculado a la operación original para mantener la traza completa del ciclo de vida de reintentos.
- **Operation (extendida de T01)**: El modelo de operación de T01 se extiende conceptualmente con: idempotency_key (nullable), attempt_count, max_retries. La extensión preserva compatibilidad con operaciones creadas sin idempotency key.

## Success Criteria

### Measurable Outcomes

- **SC-001**: El 100% de las solicitudes con idempotency key duplicada (dentro de la ventana de validez, mismo tenant) retornan la operación existente sin crear duplicados, verificable con pruebas de deduplicación automatizadas.
- **SC-002**: El 100% de las solicitudes concurrentes con la misma idempotency key resultan en exactamente una operación creada, verificable con pruebas de concurrencia.
- **SC-003**: Los actores autorizados pueden reintentar operaciones fallidas y obtener un nuevo intento en estado `pending` en menos de 3 segundos tras la solicitud.
- **SC-004**: El 100% de los reintentos de operaciones en estados no elegibles (`pending`, `running`, `completed`) son rechazados con error descriptivo.
- **SC-005**: Cada deduplicación y cada reintento generan un evento auditable consultable, verificable en el 100% de los casos.
- **SC-006**: Un actor de un tenant no puede reintentar ni deduplicar operaciones de otro tenant en el 100% de los intentos (verificado mediante pruebas de aislamiento).
- **SC-007**: Las idempotency keys expiradas permiten la creación de nuevas operaciones con la misma key, verificable con pruebas de expiración.

## Assumptions

- El modelo de operaciones de T01 (US-UIB-02-T01) está disponible y proporciona estados `pending`, `running`, `completed`, `failed` con sus transiciones definidas.
- Los endpoints de consulta de progreso de T02 (US-UIB-02-T02) están disponibles para que el resultado de una deduplicación pueda ser consultado por el actor.
- El IAM (Keycloak) proporciona tenant_id y actor_id verificados en cada solicitud, conforme a la dependencia US-UIB-01.
- El bus de eventos (Kafka) está disponible para publicar eventos auditables de deduplicación y reintento.
- El almacenamiento persistente (PostgreSQL) soporta restricciones de unicidad y bloqueo necesarios para resolución de concurrencia en idempotency keys.
- La ventana de validez por defecto de las idempotency keys será suficientemente amplia para cubrir los flujos normales de la consola (se asume 24-48 horas como rango razonable; el valor concreto se decidirá en fase de diseño).
- El límite máximo de reintentos por tipo de operación será configurable; un valor por defecto razonable se decidirá en fase de diseño.
- Las políticas de timeout, cancelación y recuperación avanzada son responsabilidad de T04 y no se incluyen en esta tarea.

## Out of Scope

- **US-UIB-02-T01**: Modelo de job/operation status (ya entregado como dependencia).
- **US-UIB-02-T02**: Endpoints y UI de consulta de progreso (ya entregado como dependencia).
- **US-UIB-02-T04**: Políticas de timeout, cancelación y recuperación de workflows complejos.
- **US-UIB-02-T05**: Pruebas de reconexión de consola y relectura de estado de jobs.
- **US-UIB-02-T06**: Documentación de semántica de reintento e intervención manual.
- **Retry automático por el sistema**: esta tarea cubre el reintento iniciado por el actor o el sistema bajo solicitud explícita. El retry automático no supervisado (sin intervención humana) puede ser construido sobre esta base pero no es parte del alcance.
- **Backoff policies**: las estrategias de espera entre reintentos (exponential backoff, jitter) son responsabilidad de la capa que invoque los reintentos, no del mecanismo de idempotencia.
- **Compensación de pasos parciales**: si una operación falla a mitad de un workflow multi-step, la compensación de pasos ya completados corresponde al motor de sagas (specs 070/072), no a este mecanismo de reintento.
