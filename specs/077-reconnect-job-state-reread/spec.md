# Feature Specification: Reconexión de Consola y Relectura de Estado de Jobs en Curso

**Feature Branch**: `077-reconnect-job-state-reread`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Crear pruebas de reconexión de la consola y relectura de estado de jobs en curso"

**Backlog Traceability**:
- Task ID: US-UIB-02-T05
- Epic: EP-16 — Backend funcional de la consola
- Historia: US-UIB-02 — Estado asíncrono, reintentos e idempotencia de aprovisionamientos administrativos
- RF cubiertos: RF-UIB-006, RF-UIB-007, RF-UIB-008
- Dependencias declaradas de la historia: US-UIB-01
- Dependencias dentro de la historia: US-UIB-02-T01 (modelo de operation status), US-UIB-02-T02 (endpoints de consulta de progreso), US-UIB-02-T03 (reintentos idempotentes con deduplicación), US-UIB-02-T04 (políticas de timeout, cancelación y recuperación)

## Objetivo y Problema que Resuelve

Las tareas anteriores de US-UIB-02 han establecido el modelo de operaciones asíncronas (T01), los endpoints de consulta de progreso (T02), reintentos idempotentes con deduplicación (T03) y las políticas de timeout, cancelación y recuperación (T04). Sin embargo, aún no se ha validado cómo se comporta la experiencia de consola cuando la conexión del usuario se interrumpe durante una operación en curso y se restablece después. Concretamente:

1. **Pérdida de contexto tras reconexión**: cuando el usuario pierde conectividad (cierre de pestaña, desconexión de red, cambio de dispositivo, expiración de sesión) y vuelve a la consola, no existe un comportamiento definido para recuperar y mostrar el estado actualizado de las operaciones que estaban en progreso.
2. **Relectura inconsistente**: al regresar, la consola podría mostrar un estado obsoleto (snapshot anterior a la desconexión) si no reconstruye el estado desde el backend, provocando confusión, acciones duplicadas o la percepción de que la operación se ha perdido.
3. **Ausencia de cobertura de pruebas**: no hay pruebas que validen estos escenarios de reconexión y relectura, dejando un gap de calidad sobre una situación frecuente en entornos reales (redes móviles, VPNs inestables, sesiones largas).

Esta tarea define la capacidad funcional de **reconexión y relectura de estado de jobs** para la consola, incluyendo el comportamiento esperado al recuperar la sesión, la sincronización con el estado real del backend y los escenarios de prueba que verifican la resiliencia de la experiencia de usuario.

## Usuarios y Consumidores Afectados

| Actor | Tipo | Valor que recibe |
| ----- | ---- | ---------------- |
| Tenant Owner | Externo | Al volver a la consola tras una desconexión, ve el estado real y actual de sus operaciones sin necesidad de recargar manualmente o duplicar acciones |
| Workspace Admin | Externo | Las operaciones sobre su workspace se muestran con su estado correcto tras reconectarse, evitando confusión y acciones erróneas |
| Superadmin | Interno | Puede confiar en que la consola refleja el estado real de operaciones de cualquier tenant, incluso tras interrupciones de red |
| Console Frontend | Interno (sistema) | Dispone de un contrato claro de reconciliación de estado al reanudar la sesión, con escenarios de prueba que lo validan |
| Console Backend | Interno (sistema) | Los endpoints de consulta de estado se consumen de forma idempotente y resiliente desde la consola tras reconexión |

## User Scenarios & Testing

### User Story 1 — Relectura automática de estado de operaciones al volver a la consola (Priority: P1)

Cuando un usuario regresa a la consola después de una interrupción (cierre de pestaña, pérdida de red, cambio de dispositivo), la consola recupera automáticamente el estado actual de todas las operaciones en curso asociadas al contexto del usuario (tenant + workspace), mostrando su estado real sin intervención manual.

**Why this priority**: Es la capacidad fundamental que garantiza que la consola sea resiliente ante desconexiones. Sin relectura automática, el resto de la funcionalidad de operaciones asíncronas pierde valor práctico en escenarios reales.

**Independent Test**: Se puede verificar iniciando una operación larga, simulando una desconexión (cierre de pestaña o corte de red), esperando a que la operación avance, y comprobando que al volver la consola muestra el estado actualizado.

**Acceptance Scenarios**:

1. **Given** un usuario con una operación en estado `running` visible en consola, **When** el usuario cierra la pestaña y la reabre después de que la operación haya completado, **Then** la consola muestra la operación en estado `completed` con su resultado final.
2. **Given** un usuario con dos operaciones en curso (`running` y `pending`), **When** pierde conectividad durante 60 segundos y la recupera, **Then** la consola refresca el estado de ambas operaciones mostrando su progreso actual sin duplicar registros.
3. **Given** un usuario que navega a la vista de operaciones después de una reconexión, **When** la consola solicita el estado al backend, **Then** los datos devueltos corresponden al estado real persistido y no a un caché local obsoleto.
4. **Given** un usuario que regresa a la consola tras una desconexión prolongada (más de 5 minutos), **When** la consola reconstruye el estado, **Then** se muestra una indicación visual de que el estado ha sido actualizado desde el servidor y cualquier operación que haya transitado a un estado terminal (`completed`, `failed`, `timed_out`, `cancelled`) lo refleja correctamente.

---

### User Story 2 — Reconciliación de estado cuando una operación transitó durante la desconexión (Priority: P1)

Si una operación cambió de estado mientras el usuario estaba desconectado (por ejemplo, pasó de `running` a `failed` o `timed_out`), la consola al reconectar detecta la discrepancia entre el estado local anterior y el estado actual del backend, actualizando la vista y notificando al usuario de los cambios relevantes.

**Why this priority**: Sin reconciliación, el usuario podría tomar decisiones basadas en información obsoleta (como reintentar una operación que ya completó exitosamente), generando duplicidades o confusión.

**Independent Test**: Se puede verificar iniciando una operación, desconectando al usuario, forzando un cambio de estado en el backend, reconectando, y comprobando que la consola muestra el nuevo estado con la notificación apropiada.

**Acceptance Scenarios**:

1. **Given** un usuario que tenía una operación en estado `running` al desconectarse, **When** la operación transitó a `failed` durante la desconexión y el usuario reconecta, **Then** la consola muestra el estado `failed` y presenta una notificación indicando que la operación falló mientras estaba desconectado.
2. **Given** un usuario que tenía una operación en estado `running` al desconectarse, **When** la operación fue cancelada por timeout (estado `timed_out`) durante la desconexión y el usuario reconecta, **Then** la consola muestra el estado `timed_out` con el motivo de expiración.
3. **Given** un usuario con múltiples operaciones que cambiaron de estado durante la desconexión, **When** reconecta, **Then** la consola agrupa las notificaciones de cambio de estado en un resumen consolidado en lugar de bombardear al usuario con notificaciones individuales.
4. **Given** un usuario que reconecta y el backend reporta que una operación está en un estado terminal con errores, **When** la consola muestra el estado actualizado, **Then** incluye información suficiente (motivo del fallo, timestamp) para que el usuario decida si reintentar.

---

### User Story 3 — Prevención de acciones duplicadas tras reconexión (Priority: P2)

Al reconectar, la consola impide que el usuario dispare acciones duplicadas sobre operaciones que ya están en progreso o completadas, aprovechando la idempotencia del backend y proporcionando feedback claro sobre el estado real antes de permitir nuevas acciones.

**Why this priority**: Complementa la relectura y reconciliación al cerrar el loop: no solo se muestra el estado correcto, sino que se protege al usuario de actuar sobre información desactualizada.

**Independent Test**: Se puede verificar desconectando al usuario, completando la operación en el backend, reconectando, y comprobando que la consola deshabilita o advierte sobre acciones redundantes.

**Acceptance Scenarios**:

1. **Given** un usuario que reconecta y ve una operación que completó exitosamente durante su ausencia, **When** intenta reintentar esa operación, **Then** la consola le advierte que la operación ya fue completada y no permite el reintento directo.
2. **Given** un usuario que reconecta y la operación sigue en estado `running`, **When** intenta disparar la misma operación de nuevo, **Then** la consola detecta la operación duplicada y muestra un aviso indicando que ya hay una operación en progreso para ese recurso.
3. **Given** un usuario que reconecta con una operación en estado `failed` y el backend soporta reintento idempotente, **When** el usuario solicita reintentar, **Then** la acción utiliza el mecanismo de idempotency key existente y la consola refleja que se trata de un reintento legítimo (no una nueva operación).

---

### User Story 4 — Relectura de estado segura en contexto multi-tenant (Priority: P2)

La relectura de estado tras reconexión respeta estrictamente el aislamiento multi-tenant: un usuario solo puede recuperar el estado de operaciones pertenecientes a sus tenants y workspaces autorizados, incluso si la sesión fue restablecida o el token renovado.

**Why this priority**: La seguridad multi-tenant es un invariante del sistema. Aunque los mecanismos de aislamiento ya existen en el backend, esta tarea asegura que los escenarios de reconexión no introducen brechas de aislamiento.

**Independent Test**: Se puede verificar simulando una reconexión y comprobando que las peticiones de relectura de estado solo devuelven operaciones del tenant autorizado.

**Acceptance Scenarios**:

1. **Given** un usuario de tenant A que reconecta a la consola, **When** la consola solicita el estado de operaciones en curso, **Then** solo recibe operaciones asociadas a tenant A y sus workspaces autorizados.
2. **Given** un usuario cuyo token expiró durante la desconexión, **When** intenta relectura de estado tras reconectar, **Then** se le solicita reautenticación antes de mostrar cualquier dato de operaciones.
3. **Given** un superadmin que reconecta, **When** solicita relectura de operaciones cross-tenant, **Then** solo ve operaciones de los tenants que tiene permiso de supervisar según su rol.

### Edge Cases

- **Reconexión durante una migración o mantenimiento del backend**: si el backend no está disponible al reconectar, la consola muestra un mensaje claro indicando que no puede obtener el estado actual y ofrece reintentar la sincronización.
- **Operación eliminada o purgada durante la desconexión**: si una operación que estaba en el estado local fue eliminada del backend (por política de retención), la consola la marca como "no disponible" en lugar de fallar silenciosamente.
- **Múltiples sesiones simultáneas del mismo usuario**: si el usuario tiene otra sesión activa que dispara acciones mientras la primera reconecta, la relectura refleja las acciones de ambas sesiones sin conflicto.
- **Token renovado con permisos reducidos**: si al reconectar el token renovado tiene menos permisos que el anterior, la consola filtra las operaciones visibles según los permisos actuales y notifica al usuario si alguna operación dejó de ser visible.
- **Desconexión muy prolongada (horas/días)**: la consola maneja el caso donde el volumen de cambios acumulados es alto, aplicando paginación o filtrado para evitar sobrecargar la interfaz.

## Requirements

### Functional Requirements

- **FR-001**: La consola DEBE, al detectar recuperación de conectividad o reapertura de sesión, solicitar al backend el estado actual de todas las operaciones en curso del usuario dentro de su contexto de tenant y workspace.
- **FR-002**: La consola DEBE reemplazar cualquier estado local cacheado con el estado actualizado recibido del backend tras la reconexión, evitando mostrar datos obsoletos.
- **FR-003**: La consola DEBE mostrar una indicación visual al usuario cuando los datos de operaciones han sido actualizados tras una reconexión, distinguiendo entre estado sincronizado y estado potencialmente desactualizado.
- **FR-004**: La consola DEBE notificar al usuario de forma consolidada cuando operaciones cambiaron a un estado terminal (`completed`, `failed`, `timed_out`, `cancelled`) durante su ausencia.
- **FR-005**: La consola DEBE prevenir acciones duplicadas sobre operaciones que ya están en progreso o completadas, deshabilitando o advirtiendo antes de ejecutar acciones redundantes.
- **FR-006**: La consola DEBE respetar el aislamiento multi-tenant en todas las peticiones de relectura de estado, solicitando solo operaciones del tenant y workspaces autorizados para la sesión actual.
- **FR-007**: La consola DEBE solicitar reautenticación si el token de sesión ha expirado antes de realizar cualquier relectura de estado.
- **FR-008**: La consola DEBE manejar la indisponibilidad del backend durante la reconexión mostrando un mensaje de error claro y ofreciendo reintentar la sincronización.
- **FR-009**: La consola DEBE manejar operaciones que fueron eliminadas o purgadas del backend durante la desconexión, marcándolas como "no disponible" en la interfaz.
- **FR-010**: Los escenarios de reconexión y relectura DEBEN estar cubiertos por pruebas automatizadas que validen el comportamiento esperado para cada user story y edge case.

### Key Entities

- **Operación asíncrona (async operation)**: registro persistido en backend que representa un proceso de aprovisionamiento con su estado actual, timestamps, progreso y metadatos. Es la entidad cuyo estado se relectura tras reconexión.
- **Contexto de sesión de consola**: combinación de identidad de usuario, tenant activo, workspace seleccionado y token de autenticación que determina qué operaciones son visibles y qué acciones están permitidas.
- **Estado local de consola**: representación en memoria/cliente del estado de operaciones que puede quedar obsoleto tras una desconexión. Debe ser reconciliado con el backend al reconectar.
- **Notificación de reconciliación**: mensaje o indicador visual que informa al usuario de cambios detectados entre el estado local previo y el estado actual del backend.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Tras una reconexión, el usuario ve el estado real de todas sus operaciones en curso en menos de 5 segundos sin necesidad de acción manual.
- **SC-002**: El 100% de los escenarios de cambio de estado durante desconexión (completed, failed, timed_out, cancelled) se reflejan correctamente al reconectar, sin mostrar estados obsoletos.
- **SC-003**: El 0% de las reconexiones permiten ver operaciones de un tenant distinto al autorizado (aislamiento verificado).
- **SC-004**: Todas las user stories y edge cases definidos en esta especificación están cubiertos por al menos una prueba automatizada.
- **SC-005**: Un usuario que reconecta no puede disparar una operación duplicada sobre un recurso que ya tiene una operación en progreso o completada, verificable en el 100% de los casos de prueba.

## Assumptions

- Los endpoints de consulta de estado de operaciones (definidos en T02) están disponibles y soportan filtrado por tenant, workspace y usuario.
- El mecanismo de idempotency key (definido en T03) está operativo para los reintentos post-reconexión.
- Las políticas de timeout y cancelación (definidas en T04) producen transiciones de estado que son consultables por los endpoints estándar.
- La consola dispone de algún mecanismo de detección de conectividad (evento online/offline del navegador o heartbeat periódico).
- El backend no proporciona notificaciones push en esta fase; la reconexión se basa en polling/re-fetch al detectar recuperación de conectividad.
