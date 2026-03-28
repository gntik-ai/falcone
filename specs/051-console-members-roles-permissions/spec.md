# Especificación de Feature: Vistas de members, invitaciones, roles y permisos

**Feature Branch**: `051-console-members-roles-permissions`
**Creada**: 2026-03-29
**Estado**: Specified
**Task ID**: US-UI-02-T03
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: L
**Dependencias de historia**: US-UI-01, US-IAM-02, US-TEN-03
**Dependencias dentro de la historia**: US-UI-02-T01 (selector de contexto), US-UI-02-T02 (estado de contexto)
**RF trazados desde la historia**: RF-UI-011, RF-UI-012, RF-UI-013, RF-UI-014, RF-UI-015, RF-UI-023, RF-UI-024
**Input**: Prompt de especificación importado para US-UI-02-T03

---

## Objetivo y problema que resuelve

Las tareas anteriores de US-UI-02 entregan el selector de tenant/workspace (T01) y la visualización de estado del contexto activo (T02). Con esas piezas, el usuario sabe *dónde* está trabajando y *en qué estado* se encuentra su ámbito, pero no puede gestionar *quién* tiene acceso ni *con qué nivel de permisos*. ¿Quiénes son los miembros del tenant? ¿Qué rol tiene cada uno? ¿Hay invitaciones pendientes? ¿Quién tiene acceso a un workspace concreto y con qué capacidades?

Sin estas vistas, la gestión de colaboración y gobernanza de acceso obliga a salir de la consola y operar directamente en Keycloak o mediante llamadas API manuales. Esto rompe la promesa del producto de ofrecer una superficie unificada de administración y genera fricción, errores y falta de visibilidad sobre quién puede hacer qué dentro de cada ámbito multi-tenant.

**US-UI-02-T03 resuelve exactamente esto**: construir las vistas de consola que permiten listar, gestionar e invitar miembros a nivel de tenant y workspace, visualizar los roles y permisos efectivos de cada miembro, y administrar el ciclo de vida de invitaciones — todo dentro del shell de la consola, respetando el contexto activo, los permisos del usuario operador y el aislamiento multi-tenant.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Superadmin de plataforma** | Consumidor final de la consola | Puede inspeccionar y gestionar la membresía de cualquier tenant y workspace de la plataforma, supervisando roles y accesos para gobernanza y cumplimiento. |
| **Tenant owner** | Consumidor final de la consola | Administra quién pertenece a su tenant, asigna roles, envía y revoca invitaciones, y controla la composición de su equipo sin salir de la consola. |
| **Workspace admin** | Consumidor final de la consola | Gestiona los miembros de su workspace, asigna roles específicos del workspace y verifica que cada persona tiene el nivel de acceso correcto para operar en ese ámbito. |
| **Miembro de tenant** | Consumidor final de la consola | Puede ver quiénes son los demás miembros de su tenant y workspace (según su nivel de permisos), lo que le da visibilidad sobre la estructura del equipo. |
| **Equipo de desarrollo (consumidor interno)** | Construye pantallas futuras de IAM avanzado | Dispone de patrones de listado, detalle y mutación de membresías e invitaciones ya validados, reutilizables para T04 (Auth/IAM) y T05 (aplicaciones externas). |

---

## User Scenarios & Testing

### User Story 1 — Listado de miembros del tenant activo (Prioridad: P1)

Como tenant owner o admin, quiero ver un listado de todos los miembros del tenant activo con su rol, estado y fecha de incorporación, para saber quién tiene acceso al tenant y con qué nivel de permisos.

**Por qué esta prioridad**: La visibilidad de quién tiene acceso al tenant es el requisito más fundamental de esta tarea. Sin un listado de miembros, ninguna otra operación de gestión de equipo tiene sentido.

**Prueba independiente**: Seleccionar un tenant con al menos tres miembros y verificar que se muestra una tabla con nombre/email, rol, estado de membresía y fecha de incorporación de cada uno.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene rol `tenant_owner` o `tenant_admin` y ha seleccionado un tenant, **cuando** navega a la sección de miembros del tenant, **entonces** se muestra un listado paginado con todos los miembros del tenant, incluyendo para cada uno: identificador o nombre del usuario, email o identificador visible, rol de tenant asignado, estado de la membresía y fecha de creación.
2. **Dado** que el tenant activo tiene más miembros que el tamaño de página por defecto, **cuando** se carga el listado, **entonces** se muestra paginación funcional que permite navegar entre páginas sin perder el contexto del tenant.
3. **Dado** que el usuario tiene rol `tenant_viewer` o `tenant_developer`, **cuando** navega a la sección de miembros, **entonces** puede ver el listado en modo lectura (sin acciones de mutación), o bien se le informa de que no tiene permisos suficientes para ver la lista, según lo que devuelva la API.
4. **Dado** que la llamada a la API de membresías falla, **cuando** se intenta cargar el listado, **entonces** se muestra un mensaje de error con opción de reintentar, sin mostrar datos ficticios.
5. **Dado** que el tenant activo no tiene miembros registrados (estado teórico tras bootstrap), **cuando** se carga el listado, **entonces** se muestra un estado vacío con un mensaje orientativo y, si el usuario tiene permisos, un enlace o botón para invitar al primer miembro.

---

### User Story 2 — Listado de miembros del workspace activo (Prioridad: P1)

Como workspace admin, quiero ver un listado de los miembros del workspace activo con su rol específico de workspace, para saber quién puede operar dentro de este ámbito.

**Por qué esta prioridad**: La membresía de workspace es independiente de la de tenant. Un usuario puede pertenecer al tenant pero no tener acceso a un workspace concreto. Esta vista es igual de fundamental que la de tenant para el control de acceso granular.

**Prueba independiente**: Seleccionar un workspace con al menos dos miembros y verificar que se muestra una tabla con sus roles de workspace, diferenciada del listado de tenant.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene rol `workspace_admin` o superior y ha seleccionado un workspace, **cuando** navega a la sección de miembros del workspace, **entonces** se muestra un listado paginado con los miembros del workspace, incluyendo: identificador o nombre del usuario, rol de workspace asignado, estado de la membresía y fecha de creación.
2. **Dado** que un miembro del tenant no tiene membresía en el workspace activo, **cuando** se carga el listado de miembros del workspace, **entonces** ese usuario NO aparece en la lista (la membresía de workspace es explícita, no heredada del tenant).
3. **Dado** que el usuario cambia de workspace mediante el selector de contexto, **cuando** se actualiza el contexto, **entonces** el listado de miembros se recarga con los miembros del nuevo workspace.
4. **Dado** que no hay workspace seleccionado, **cuando** el usuario intenta acceder a la vista de miembros de workspace, **entonces** se muestra un mensaje indicando que debe seleccionar un workspace.

---

### User Story 3 — Envío de invitaciones al tenant (Prioridad: P1)

Como tenant owner o admin, quiero poder enviar invitaciones a nuevos colaboradores para que se unan al tenant con un rol específico, para incorporar personas al equipo desde la consola.

**Por qué esta prioridad**: Sin invitaciones, la única forma de agregar miembros es a través de la API o Keycloak directamente. La capacidad de invitar es el segundo pilar de la gestión de equipo, inmediatamente después de la visibilidad.

**Prueba independiente**: Desde la vista de miembros del tenant, enviar una invitación a un email, elegir un rol y verificar que la invitación aparece en la lista de invitaciones pendientes.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene permisos para crear invitaciones en el tenant activo, **cuando** acciona la creación de una nueva invitación, **entonces** se muestra un formulario que solicita al menos: email o identificador del destinatario, rol de tenant a asignar, y opcionalmente un workspace destino con rol de workspace.
2. **Dado** que el usuario completa el formulario con datos válidos y confirma, **cuando** se envía la solicitud a la API, **entonces** se crea la invitación, se muestra una confirmación de éxito, y la invitación aparece en el listado de invitaciones pendientes.
3. **Dado** que el usuario intenta invitar a un email que ya tiene una invitación pendiente para el mismo tenant, **cuando** se envía la solicitud, **entonces** la API devuelve un error de duplicado y la consola muestra un mensaje claro indicando que ya existe una invitación pendiente para ese destinatario.
4. **Dado** que el usuario no tiene permisos para crear invitaciones, **cuando** accede a la sección de miembros, **entonces** la acción de invitar no está disponible (botón deshabilitado o no visible).
5. **Dado** que la API rechaza la invitación por cualquier motivo (cuota de miembros alcanzada, rol inválido, etc.), **cuando** se recibe el error, **entonces** se muestra el motivo del rechazo sin exponer detalles internos.

---

### User Story 4 — Gestión del ciclo de vida de invitaciones (Prioridad: P2)

Como tenant owner o admin, quiero ver las invitaciones pendientes, aceptadas, revocadas y expiradas del tenant, y poder revocar invitaciones pendientes, para mantener control sobre quién está en proceso de incorporarse.

**Por qué esta prioridad**: Una vez que se pueden enviar invitaciones (P1), es necesario gestionar su ciclo de vida. Es P2 porque el envío y la aceptación son el flujo crítico; la revocación y la visibilidad del historial son complementarias pero no bloquean la operación básica.

**Prueba independiente**: Verificar que la lista de invitaciones muestra todas las invitaciones con su estado. Revocar una invitación pendiente y confirmar que cambia a estado `revoked`.

**Escenarios de aceptación**:

1. **Dado** que el tenant tiene invitaciones en distintos estados, **cuando** el usuario navega a la sección de invitaciones, **entonces** se muestra un listado con cada invitación incluyendo: destinatario (enmascarado parcialmente), rol asignado, estado (`pending`, `accepted`, `revoked`, `expired`), fecha de creación y fecha de expiración.
2. **Dado** que existe una invitación en estado `pending`, **cuando** el usuario con permisos acciona la revocación, **entonces** se envía la solicitud de revocación a la API, la invitación pasa a estado `revoked` y se muestra una confirmación.
3. **Dado** que una invitación está en estado `accepted`, `revoked` o `expired`, **cuando** el usuario intenta revocarla, **entonces** la acción de revocar no está disponible para esa invitación.
4. **Dado** que el usuario filtra las invitaciones por estado, **cuando** selecciona un filtro (ej. solo `pending`), **entonces** el listado muestra únicamente las invitaciones que coinciden con el filtro.

---

### User Story 5 — Visualización de roles y permisos del contexto activo (Prioridad: P2)

Como tenant owner, admin o superadmin, quiero ver los roles disponibles a nivel de tenant y workspace junto con una descripción de los permisos que otorga cada rol, para entender el modelo de acceso antes de asignar roles a miembros o invitaciones.

**Por qué esta prioridad**: Asignar un rol sin entender qué permisos otorga conduce a errores de gobernanza. Esta vista es P2 porque complementa las operaciones de membresía e invitación (P1), proporcionando la información necesaria para tomar decisiones informadas.

**Prueba independiente**: Navegar a la sección de roles y verificar que se listan los roles de tenant y workspace con sus permisos asociados.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene permisos de lectura sobre la configuración de roles, **cuando** navega a la sección de roles del tenant, **entonces** se muestra un listado de los roles disponibles a nivel de tenant (`tenant_owner`, `tenant_admin`, `tenant_developer`, `tenant_viewer`) con una descripción del alcance de cada uno.
2. **Dado** que el usuario tiene un workspace seleccionado, **cuando** navega a la sección de roles del workspace, **entonces** se muestra un listado de los roles disponibles a nivel de workspace (`workspace_admin`, `workspace_developer`, `workspace_operator`, `workspace_auditor`, `workspace_viewer`) con una descripción del alcance de cada uno.
3. **Dado** que el usuario expande o selecciona un rol, **cuando** se muestra el detalle, **entonces** se listan los permisos o capacidades principales que otorga ese rol, presentados como descripciones funcionales (no como códigos técnicos internos).
4. **Dado** que el modelo de roles cambia en el backend (ej. se añade un rol), **cuando** se recarga la sección, **entonces** se refleja el catálogo actualizado desde la API.

---

### User Story 6 — Cambio de rol de un miembro existente (Prioridad: P2)

Como tenant owner o admin, quiero poder cambiar el rol de un miembro del tenant o workspace, para ajustar su nivel de acceso según las necesidades del equipo.

**Por qué esta prioridad**: Es P2 porque modificar roles es menos frecuente que invitar o listar miembros, pero es esencial para la gobernanza continua.

**Prueba independiente**: Seleccionar un miembro, cambiar su rol de `tenant_developer` a `tenant_admin` y verificar que el listado refleja el cambio.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene permisos para modificar membresías y selecciona un miembro del tenant, **cuando** acciona el cambio de rol, **entonces** se muestra un selector con los roles disponibles para ese ámbito (tenant o workspace).
2. **Dado** que el usuario selecciona un nuevo rol y confirma, **cuando** se envía la actualización a la API, **entonces** la membresía se actualiza, se muestra una confirmación y el listado refleja el nuevo rol.
3. **Dado** que el usuario intenta cambiar su propio rol de `tenant_owner` a uno inferior, **cuando** confirma, **entonces** la API rechaza la operación si no hay otro `tenant_owner` (protección contra pérdida de owner) y la consola muestra el motivo del rechazo.
4. **Dado** que el usuario intenta cambiar el rol de otro miembro a `tenant_owner`, **cuando** confirma, **entonces** se ejecuta como una operación especial de transferencia de ownership (si la API así lo requiere) o bien la API acepta la elevación si el solicitante tiene permisos suficientes.
5. **Dado** que el usuario no tiene permisos para modificar membresías, **cuando** ve el listado de miembros, **entonces** la acción de cambio de rol no está disponible.

---

### User Story 7 — Suspensión y revocación de membresía (Prioridad: P3)

Como tenant owner o admin, quiero poder suspender o revocar la membresía de un miembro del tenant o workspace, para restringir o eliminar su acceso cuando ya no sea necesario.

**Por qué esta prioridad**: Es P3 porque la operación es menos frecuente que las anteriores y existen mecanismos alternativos (como la suspensión desde Keycloak). Sin embargo, ofrecerlo desde la consola completa el ciclo de vida de la membresía.

**Prueba independiente**: Seleccionar un miembro activo, suspender su membresía y verificar que el estado cambia a `suspended` en el listado. Luego revocar y verificar que pasa a `revoked`.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene permisos y selecciona un miembro activo, **cuando** acciona la suspensión, **entonces** se solicita confirmación, se envía a la API, la membresía pasa a estado `suspended` y el listado lo refleja.
2. **Dado** que el usuario selecciona un miembro suspendido, **cuando** acciona la reactivación, **entonces** la membresía vuelve a estado `active`.
3. **Dado** que el usuario acciona la revocación de un miembro, **cuando** confirma la operación destructiva, **entonces** la membresía pasa a estado `revoked` y el usuario pierde acceso al ámbito correspondiente.
4. **Dado** que el usuario intenta suspender o revocar al único `tenant_owner`, **cuando** confirma, **entonces** la API rechaza la operación y la consola muestra el motivo.
5. **Dado** que el usuario suspende o revoca un miembro que tiene membresías de workspace, **cuando** la operación se completa a nivel de tenant, **entonces** la consola indica que las membresías de workspace del usuario también podrían verse afectadas según las reglas del backend.

---

### Edge Cases

- **Cambio de contexto durante una operación**: Si el usuario cambia de tenant o workspace mientras tiene abierto un formulario de invitación o de cambio de rol, la operación debe descartarse o mostrar un aviso de que el contexto ha cambiado, evitando enviar la mutación contra el tenant/workspace anterior.
- **Miembro eliminado o suspendido por otro admin en paralelo**: Si al intentar cambiar el rol de un miembro la API devuelve un error porque la membresía ya no existe o cambió de estado, la consola debe refrescar el listado y mostrar un mensaje informativo en lugar de un error genérico.
- **Invitación a un usuario que ya es miembro**: La API debe rechazarlo. La consola debe mostrar un mensaje claro indicando que el usuario ya tiene membresía activa en el ámbito.
- **Tenant suspendido o en estado no operativo**: Si el tenant activo está suspendido, las operaciones de mutación (invitar, cambiar rol, suspender miembro) pueden estar bloqueadas por la API. La consola debe mostrar los listados en modo lectura y explicar que las operaciones de escritura no están disponibles por el estado del tenant (complementando los banners de T02).
- **Permisos insuficientes para ver emails completos**: Si la API enmascara el email del destinatario de invitaciones por privacidad, la consola debe mostrar la versión enmascarada sin intentar resolver el email completo.
- **Cuota de miembros del tenant alcanzada**: Si el plan del tenant impone un límite de miembros y ya se alcanzó, la acción de invitar debe estar deshabilitada o mostrar un mensaje indicando que se requiere una actualización de plan.
- **Latencia alta en la API de membresías**: Los listados y formularios deben mostrar estados de carga claros y no bloquear la interfaz. Los botones de acción deben deshabilitarse durante la ejecución de mutaciones para evitar doble envío.
- **Workspace sin miembros propios**: Un workspace recién creado puede no tener membresías explícitas (solo las heredadas del bootstrap). La vista debe mostrar un estado vacío orientativo invitando a agregar miembros.

---

## Requirements

### Requisitos funcionales

- **FR-001**: El sistema DEBE ofrecer una vista de listado de miembros del tenant activo, accesible desde la sección de miembros dentro del contexto de tenant, que muestre: identificador o nombre del usuario, email o identificador visible, rol de tenant, estado de la membresía y fecha de creación.
- **FR-002**: El sistema DEBE ofrecer una vista de listado de miembros del workspace activo, accesible desde la sección de miembros dentro del contexto de workspace, que muestre: identificador o nombre del usuario, rol de workspace, estado de la membresía y fecha de creación.
- **FR-003**: Ambos listados de miembros (tenant y workspace) DEBEN soportar paginación y actualizarse al cambiar de contexto (tenant o workspace).
- **FR-004**: El sistema DEBE permitir a usuarios con permisos adecuados enviar invitaciones a nivel de tenant, especificando al menos: email o identificador del destinatario y rol de tenant a asignar.
- **FR-005**: El formulario de invitación DEBE permitir opcionalmente especificar un workspace destino y un rol de workspace para la invitación.
- **FR-006**: El sistema DEBE ofrecer una vista de listado de invitaciones del tenant activo que muestre: destinatario (enmascarado si la API así lo devuelve), rol asignado, estado (`pending`, `accepted`, `revoked`, `expired`), fecha de creación y fecha de expiración.
- **FR-007**: El sistema DEBE permitir a usuarios con permisos adecuados revocar invitaciones que estén en estado `pending`.
- **FR-008**: El sistema DEBE ofrecer una vista de roles disponibles a nivel de tenant y workspace que muestre nombre del rol y descripción funcional de los permisos que otorga.
- **FR-009**: El sistema DEBE permitir a usuarios con permisos adecuados cambiar el rol de un miembro existente a nivel de tenant o workspace.
- **FR-010**: El sistema DEBE permitir a usuarios con permisos adecuados suspender, reactivar y revocar membresías a nivel de tenant y workspace.
- **FR-011**: Las acciones de mutación (invitar, cambiar rol, suspender, revocar) NO DEBEN estar disponibles (botón deshabilitado o no visible) para usuarios sin los permisos necesarios.
- **FR-012**: Si la API devuelve un error en cualquier operación de listado o mutación, la consola DEBE mostrar un mensaje de error contextualizado con opción de reintentar (para listados) o con el motivo del rechazo (para mutaciones), sin mostrar datos ficticios ni errores genéricos.
- **FR-013**: Las vistas de miembros, invitaciones y roles DEBEN respetar el contexto activo de tenant y workspace proporcionado por T01 y actualizarse automáticamente al cambiar de contexto.
- **FR-014**: Si el tenant activo está en un estado no operativo (suspendido, pendiente de activación), las operaciones de mutación DEBEN mostrarse deshabilitadas con un mensaje explicativo, y los listados DEBEN permanecer visibles en modo lectura.
- **FR-015**: Las tablas, formularios y acciones DEBEN ser accesibles por teclado y tener semántica ARIA adecuada (roles de tabla, etiquetas de formulario, anuncios de acciones exitosas o fallidas para lectores de pantalla).
- **FR-016**: El sistema DEBE mostrar estados de carga durante la obtención de datos de membresías, invitaciones o roles, y DEBE deshabilitar botones de acción durante la ejecución de mutaciones para evitar doble envío.

### Entidades clave

- **Tenant membership** (`tenant_membership`): Registro auditable que vincula un `platform_user` a un `tenant` con un rol de tenant (`tenant_owner`, `tenant_admin`, `tenant_developer`, `tenant_viewer`) y un estado de membresía (`pending_activation`, `active`, `suspended`, `revoked`). Se obtiene de `GET /v1/tenants/{tenantId}/memberships/{id}` y se crea/muta con `POST /v1/tenants/{tenantId}/memberships`.
- **Workspace membership** (`workspace_membership`): Registro auditable que vincula un `platform_user` a un `workspace` con un rol de workspace (`workspace_admin`, `workspace_developer`, `workspace_operator`, `workspace_auditor`, `workspace_viewer`) y un estado de membresía. Se obtiene de `GET /v1/workspaces/{workspaceId}/memberships/{id}` y se crea/muta con `POST /v1/workspaces/{workspaceId}/memberships`. La membresía de workspace es explícita y no se hereda automáticamente de la membresía de tenant.
- **Invitation** (`invitation`): Registro de onboarding que representa una invitación a unirse a un tenant y opcionalmente a un workspace, con estado (`pending`, `accepted`, `revoked`, `expired`), rol destino, email enmascarado del destinatario y política de expiración. Se gestiona bajo `POST /v1/tenants/{tenantId}/invitations`, con sub-recursos de aceptación y revocación.
- **Roles de plataforma**: Conjunto cerrado de roles definidos en el modelo de autorización contextual:
  - **Roles de tenant**: `tenant_owner`, `tenant_admin`, `tenant_developer`, `tenant_viewer`.
  - **Roles de workspace**: `workspace_admin`, `workspace_developer`, `workspace_operator`, `workspace_auditor`, `workspace_viewer`.
  - Los permisos de cada rol están definidos en la matriz de autorización del backend (allow-list); la consola los presenta descriptivamente.

---

## Permisos, aislamiento multi-tenant, auditoría y seguridad

### Aislamiento

- Los listados de miembros e invitaciones muestran exclusivamente los datos del tenant y workspace seleccionados. La consola no accede ni muestra datos de otros tenants.
- La membresía de workspace es explícita e independiente: pertenecer a un tenant no otorga automáticamente acceso a ningún workspace. La consola debe reflejar esta separación mostrando listados diferenciados.
- Todas las operaciones pasan por la API del backend, que aplica filtrado por permisos y aislamiento por tenant. La consola no implementa lógica de autorización propia.

### Permisos y visibilidad

- Las acciones de escritura (invitar, cambiar rol, suspender, revocar) requieren roles con permisos de gestión de membresía: típicamente `tenant_owner` o `tenant_admin` para operaciones de tenant, y `workspace_admin` para operaciones de workspace.
- Los roles de lectura (`tenant_viewer`, `tenant_developer`, `workspace_viewer`) pueden ver listados de miembros pero no ejecutar mutaciones. La disponibilidad exacta depende de lo que devuelva la API.
- Si la API devuelve datos parciales por permisos (ej. email enmascarado, campos omitidos), la consola muestra lo disponible sin generar error.
- La visibilidad de roles y su descripción de permisos está disponible para cualquier miembro del ámbito correspondiente.

### Seguridad

- Los datos de membresías, invitaciones y roles se obtienen mediante las mismas credenciales y mecanismo de autenticación que el resto de la consola. No se requieren tokens ni flujos adicionales.
- No se persisten datos de membresía en el cliente más allá de la sesión del navegador (en memoria). Los datos se refrescan al cambiar de contexto o recargar.
- Las invitaciones no exponen el token o secreto de aceptación en la consola del remitente. Ese secreto solo está disponible para el destinatario a través del flujo de aceptación.
- Las operaciones de mutación requieren confirmación explícita del usuario antes de enviarse, especialmente las destructivas (revocación de membresía).

### Auditoría

- Las operaciones de mutación (invitación, cambio de rol, suspensión, revocación) generan eventos de auditoría en el backend. La consola no registra auditoría propia; la trazabilidad se garantiza a través de la API y el `X-Correlation-Id` estándar.
- La lectura de listados de miembros e invitaciones es una operación de consulta que no genera eventos de auditoría propios desde la consola.

### Cuotas y límites

- El plan del tenant puede imponer un límite de miembros o invitaciones. Si la cuota está agotada, la API rechazará la creación de invitaciones o membresías. La consola debe reflejar este rechazo con un mensaje claro.
- La consola no calcula ni valida cuotas por su cuenta; se apoya en la respuesta de la API.

---

## Criterios de éxito

### Resultados medibles

- **SC-001**: Un tenant owner puede ver el listado completo de miembros de su tenant con roles y estados sin necesidad de acceder a Keycloak ni a la API directamente.
- **SC-002**: Un tenant owner puede enviar una invitación a un nuevo colaborador, especificando email y rol, y ver la invitación reflejada en el listado de invitaciones pendientes, en menos de 5 segundos (asumiendo latencia de API normal).
- **SC-003**: Un workspace admin puede ver los miembros de su workspace con sus roles específicos de workspace, diferenciados de la vista de miembros del tenant.
- **SC-004**: Un tenant owner puede revocar una invitación pendiente y ver el cambio de estado reflejado en el listado sin recargar la página.
- **SC-005**: Un tenant owner puede cambiar el rol de un miembro existente y ver el cambio reflejado en el listado sin recargar la página.
- **SC-006**: Un usuario sin permisos de escritura puede ver los listados de miembros en modo lectura sin que aparezcan acciones de mutación disponibles.
- **SC-007**: Al cambiar de tenant o workspace, los listados de miembros e invitaciones se actualizan automáticamente para reflejar los datos del nuevo contexto.
- **SC-008**: La vista de roles muestra los roles de tenant y workspace con una descripción funcional comprensible que permite al usuario tomar decisiones informadas al asignar roles.
- **SC-009**: Las tablas, formularios y acciones son operables mediante teclado y legibles por tecnologías de asistencia.
- **SC-010**: Suspender o revocar un miembro desde la consola se refleja inmediatamente en el listado y la API confirma que el acceso del usuario fue restringido.

---

## Supuestos

- La API del backend expone endpoints de listado de membresías de tenant (`GET /v1/tenants/{tenantId}/memberships/...`) y workspace (`GET /v1/workspaces/{workspaceId}/memberships/...`) con soporte de paginación. Estos contratos están definidos en las familias `tenants` y `workspaces` de la superficie API pública.
- La API del backend expone endpoints de creación, lectura y revocación de invitaciones bajo `POST /v1/tenants/{tenantId}/invitations`, `GET /v1/tenants/{tenantId}/invitations/{id}`, y los sub-recursos de aceptación y revocación.
- El modelo de roles del backend sigue el catálogo definido en el modelo de autorización contextual: roles de plataforma, tenant y workspace con una matriz de permisos allow-list.
- El selector de contexto (US-UI-02-T01) ya entrega el contexto activo (tenant ID, workspace ID) como estado global reactivo de la aplicación.
- El shell de la consola (US-UI-01) ya proporciona el layout estructural (header, sidebar, área de contenido, rutas protegidas) donde integrar las nuevas vistas.
- Los endpoints de membresía e invitación devuelven datos filtrados por los permisos del usuario autenticado, por lo que la consola no necesita implementar lógica de autorización adicional.

## Riesgos

- **Endpoints de listado de membresías sin paginación**: Si la API actual no soporta paginación en los endpoints de membresía, los tenants con muchos miembros podrían experimentar problemas de rendimiento. Mitigación: la consola debe implementar paginación del lado del cliente como fallback y escalar el requerimiento al equipo de backend.
- **Descripción de permisos por rol no disponible en la API**: Si la API no expone una descripción funcional de los permisos de cada rol, la consola podría necesitar mantener un catálogo estático de descripciones sincronizado manualmente. Esto es un riesgo de mantenimiento si se añaden nuevos roles.
- **Consistencia eventual en operaciones de membresía**: Las mutaciones de membresía pueden no reflejarse instantáneamente en Keycloak. La consola muestra el estado según la API del control plane, pero el acceso efectivo del usuario afectado puede tener un retraso de propagación al IAM provider.

## Fuera de alcance de esta tarea

- Implementar el selector de tenant y workspace con persistencia de contexto (US-UI-02-T01; esta tarea lo consume como dependencia).
- Mostrar estado de tenant y workspace en shell y páginas relevantes (US-UI-02-T02; esta tarea lo consume como dependencia).
- Construir vistas de Auth/IAM para users, roles, scopes, clients, providers OIDC/SAML y aplicaciones externas (US-UI-02-T04). Esta tarea gestiona membresías y roles de la *plataforma BaaS*, no la administración de IAM del tenant end-user.
- Gestión de aplicaciones externas vinculadas al workspace (US-UI-02-T05).
- Pruebas E2E de cambio de contexto y administración de miembros/Auth (US-UI-02-T06).
- Flujo de aceptación de invitación desde la perspectiva del destinatario (el destinatario acepta a través de un enlace/flujo fuera de la consola del remitente; esta tarea solo gestiona el envío y seguimiento de invitaciones desde la consola del administrador).
- Transferencia de ownership de tenant (existe un endpoint dedicado `POST /v1/tenants/{tenantId}/ownership-transfers`; su integración en consola puede abordarse como mejora futura o como parte de T04).
- Actualización en tiempo real de listados vía WebSocket o SSE (los datos se refrescan al cambiar contexto, navegar o recargar).
- Creación o modificación de definiciones de roles (los roles son un catálogo cerrado definido en el backend; esta tarea solo los presenta y permite asignarlos).
