# Especificación — US-BKP-02-T03: Reaprovisionamiento de tenant a partir de export

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-02-T03                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-02 — Exportación de configuración funcional y reprovisionamiento de tenants |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-003, RF-BKP-004                                               |
| **Dependencias**    | US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02                  |

**Feature Branch**: `117-tenant-reprovision-from-export`
**Created**: 2026-04-01
**Status**: Draft

---

## 1. Objetivo y problema que resuelve

### Problema

US-BKP-02-T01 permite exportar la configuración funcional de un tenant como un artefacto JSON estructurado, y US-BKP-02-T02 garantiza que ese artefacto tiene un formato versionado, validable y migrable. Sin embargo, **no existe un mecanismo para utilizar ese artefacto como input para reconstruir o reaprovisionar la configuración de un tenant**.

Sin esta capacidad:

1. **El artefacto de exportación es solo un documento de referencia**, no un instrumento operativo. Un SRE que necesita reconstruir un tenant tras un incidente debe recrear manualmente cada recurso (roles IAM, esquemas PostgreSQL, topics Kafka, funciones, buckets) consultando el artefacto como guía, pero ejecutando cada paso por separado en cada subsistema.
2. **La migración de configuración entre entornos** (staging → producción, región A → región B) requiere un esfuerzo manual proporcional a la complejidad del tenant, con alto riesgo de omisiones y errores.
3. **Los identificadores internos cambian entre entornos y entre tenants**: un artefacto exportado de un tenant en un entorno contiene IDs de realm, schemas, namespaces, prefijos de topics y buckets que no son válidos en el tenant o entorno destino. Sin un mecanismo de ajuste de identificadores, el artefacto no es directamente aplicable.

### Objetivo de esta tarea

Implementar un flujo de reaprovisionamiento que permita a un actor autorizado aplicar un artefacto de exportación (validado y opcionalmente migrado por T02) sobre un tenant destino, reconstruyendo su configuración funcional dominio por dominio, con soporte para ajuste manual de identificadores cuando los del artefacto de origen no coinciden con los del entorno destino.

El resultado es que un operador pueda tomar un artefacto de exportación, declarar el tenant destino, revisar y ajustar los identificadores que difieren, y ejecutar la aplicación de la configuración de forma controlada, dominio por dominio, con visibilidad del progreso y resultado de cada dominio.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecuta el reaprovisionamiento como parte de procedimientos de recuperación o migración | Reconstruye la configuración funcional de un tenant en minutos en lugar de horas, con trazabilidad completa del proceso y garantía de que cada dominio se aplicó o falló de forma explícita. |
| **Superadmin** | Inicia el reaprovisionamiento para clonar configuraciones entre tenants o entornos | Puede duplicar la configuración de un tenant de referencia (p. ej., plantilla golden tenant) en un tenant nuevo, ajustando solo los identificadores que cambian. |
| **Proceso interno (automatización de DR)** | Ejecuta reaprovisionamiento como paso de un runbook de disaster recovery | Integra la reconstrucción de configuración como acción programática dentro de pipelines de recuperación, reduciendo el RTO (Recovery Time Objective). |
| **Tenant owner** | Consumidor indirecto | Garantía de que su configuración puede ser reconstruida a partir de un export previo, reduciendo el impacto de incidentes que afecten la configuración de su tenant. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Reaprovisionamiento completo de un tenant vacío a partir de un export**

> Un SRE tiene un artefacto de exportación de un tenant de producción (todos los dominios con status `ok`). Crea un tenant nuevo y vacío en el entorno destino. Envía el artefacto al endpoint de reaprovisionamiento indicando el `tenant_id` destino. El sistema detecta que los identificadores del tenant de origen (realm, schema, namespace, prefijos) difieren del destino y presenta un **mapa de identificadores** con los valores de origen y los valores esperados en el destino. El operador revisa el mapa, confirma o ajusta los valores, y ejecuta la aplicación. El sistema aplica la configuración dominio por dominio (IAM, PostgreSQL metadata, MongoDB metadata, Kafka topics/ACLs, funciones, buckets/políticas), reportando el resultado de cada uno.

**E2 — Reaprovisionamiento parcial (solo dominios seleccionados)**

> Un superadmin necesita restaurar solo la configuración IAM y las funciones de un tenant tras un error de configuración. Envía el artefacto completo pero indica que solo se apliquen los dominios `iam` y `functions`. El sistema aplica únicamente esos dos dominios y omite los demás. Los dominios no solicitados no se modifican en el tenant destino.

**E3 — Reaprovisionamiento sobre un tenant que ya tiene configuración (merge parcial)**

> El tenant destino ya tiene algunos roles IAM y topics Kafka configurados. El operador inicia el reaprovisionamiento. El sistema aplica los recursos del artefacto que no existen en el destino y reporta como `skipped` los recursos que ya existen con configuración equivalente. Si un recurso existe pero difiere, se reporta como `conflict` y no se sobrescribe automáticamente. El operador recibe un resumen de qué se aplicó, qué se omitió y qué conflictos se detectaron.

**E4 — Ajuste manual de identificadores antes de la aplicación**

> El artefacto fue exportado del tenant `tenant-abc` en el entorno staging con realm `staging-abc`, schema `stg_abc`, y prefijo de topics `stg.abc.`. El tenant destino es `tenant-xyz` en producción con realm `prod-xyz`, schema `prod_xyz`, y prefijo `prod.xyz.`. El sistema genera un mapa de reemplazo de identificadores que el operador puede revisar y modificar antes de confirmar la aplicación. El mapa se aplica transversalmente al artefacto antes de que los aplicadores por dominio operen.

**E5 — Dry-run (simulación sin aplicación efectiva)**

> Un SRE quiere evaluar qué ocurriría si aplica un artefacto sobre un tenant destino sin ejecutar cambios reales. Invoca el endpoint en modo `dry_run`. El sistema recorre todos los dominios, evalúa qué recursos se crearían, cuáles se omitirían y cuáles generarían conflictos, y devuelve el plan de aplicación sin modificar ningún subsistema.

**E6 — Reaprovisionamiento a partir de un artefacto migrado**

> Un artefacto fue exportado hace meses con `format_version: 1.0.0`. La plataforma actual usa `format_version: 2.1.0`. El operador primero migra el artefacto usando el endpoint de T02 (`POST /config/migrate`), obtiene el artefacto migrado, y luego lo envía al endpoint de reaprovisionamiento. El sistema valida que el artefacto está en la versión actual del formato antes de proceder.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Artefacto con un dominio en status `error` o `not_available` | Ese dominio se omite del reaprovisionamiento. Se reporta como `skipped_not_exportable` en el resultado. No se intenta aplicar datos parciales o inexistentes. |
| Artefacto con un dominio en status `empty` | El dominio se procesa pero no genera cambios (no hay items). Se reporta como `applied_empty` en el resultado. |
| Tenant destino no existe | El endpoint devuelve `HTTP 404` con mensaje claro. No se intenta crear el tenant; la creación de tenants es responsabilidad de US-TEN-04. |
| El artefacto no pasa validación de formato (T02) | El endpoint rechaza el artefacto con `HTTP 422` indicando que debe validarse y/o migrarse antes del reaprovisionamiento. No se ejecuta ningún aplicador. |
| Fallo de un aplicador durante el reaprovisionamiento (p. ej., Keycloak no responde) | El dominio fallido se reporta con `status: "error"` y mensaje descriptivo. **Los demás dominios no se revierten.** El reaprovisionamiento es best-effort por dominio: cada dominio se aplica de forma independiente. El operador puede reintentar solo los dominios fallidos. |
| Conflicto de recursos: un rol IAM del artefacto ya existe en el destino con configuración diferente | El recurso se reporta como `conflict` con detalle de la diferencia. No se sobrescribe automáticamente. El operador puede resolverlo manualmente o, en futuras iteraciones, aplicar una política de resolución (fuera de alcance). |
| Artefacto con secretos redactados (`***REDACTED***`) | Los valores redactados no se aplican. Si un recurso del artefacto requiere un secreto (p. ej., variable de entorno de una función), se crea el recurso sin el secreto y se reporta como `applied_with_warnings` indicando que los secretos deben configurarse manualmente. |
| Mapa de identificadores con un valor destino vacío o inválido | El endpoint rechaza el mapa con `HTTP 400` indicando qué entrada es inválida. No se ejecuta la aplicación hasta que el mapa sea válido. |
| Reaprovisionamiento de un artefacto idéntico al estado actual del tenant destino (noop) | Todos los recursos se reportan como `skipped` (ya existen con configuración equivalente). El resultado general es `success` con cero cambios aplicados. |
| Dos reaprovisionamientos concurrentes sobre el mismo tenant | El segundo intento recibe `HTTP 409 Conflict` indicando que ya hay un reaprovisionamiento en curso para ese tenant. Se usa un lock a nivel de tenant. |

### 3.3 Reglas de negocio y gobierno

**RN-T03-01 — Solo configuración funcional, no datos de usuario**
El reaprovisionamiento recrea la configuración funcional descrita en el artefacto (roles, esquemas, topics, funciones, políticas de buckets). **No restaura datos de usuario**, contenido de objetos almacenados, mensajes en topics ni registros de tablas/colecciones.

**RN-T03-02 — El artefacto debe estar en la versión actual del formato**
El endpoint de reaprovisionamiento solo acepta artefactos cuya `format_version` sea compatible con la versión actual de la plataforma (mismo major, según RN-T02-03 de T02). Si el artefacto es de un major anterior, el operador debe migrarlo primero usando el endpoint de T02.

**RN-T03-03 — El mapa de identificadores es obligatorio cuando difieren origen y destino**
Si el `tenant_id` del artefacto difiere del tenant destino, el sistema genera un mapa de identificadores propuesto y requiere que el operador lo confirme (o ajuste) antes de proceder. Si el operador no proporciona el mapa en la request, el endpoint devuelve el mapa propuesto como respuesta para que lo revise, sin ejecutar la aplicación.

**RN-T03-04 — Cada dominio tiene un aplicador independiente**
Así como la exportación usa recolectores (T01), el reaprovisionamiento usa aplicadores (appliers), uno por dominio. Cada aplicador sabe cómo crear o verificar la configuración funcional de su subsistema a partir de los items del artefacto. Si no existe aplicador para un dominio, ese dominio se omite con status `skipped_no_applier`.

**RN-T03-05 — No se sobrescriben recursos existentes con configuración diferente**
Cuando un recurso del artefacto ya existe en el tenant destino con configuración diferente, el aplicador lo reporta como `conflict` y no lo modifica. Esta política conservadora protege la configuración existente del tenant destino. La resolución de conflictos es manual o delegada a una tarea futura (US-BKP-02-T04 define las validaciones previas).

**RN-T03-06 — El reaprovisionamiento no es transaccional cross-domain**
La aplicación de cada dominio es independiente. Si un dominio falla, los dominios ya aplicados no se revierten. Esto es consistente con el diseño de la exportación (RN-05 de T01: la exportación tampoco es transaccional cross-domain). El operador tiene visibilidad del estado de cada dominio y puede actuar en consecuencia.

**RN-T03-07 — Los secretos redactados no se restauran**
Los valores marcados como `***REDACTED***` en el artefacto no se aplican. Los recursos que dependen de secretos se crean sin ellos, y el operador debe configurar los secretos manualmente tras el reaprovisionamiento. Esto es una consecuencia de RN-05 de T01 (redacción obligatoria de secretos en la exportación).

**RN-T03-08 — Modo dry-run obligatorio como buena práctica**
El sistema ofrece un modo `dry_run` que simula el reaprovisionamiento completo sin aplicar cambios. Aunque no se fuerza al operador a ejecutar un dry-run antes de la aplicación real, la documentación y la UX lo recomiendan explícitamente.

**RN-T03-09 — Lock de concurrencia por tenant**
Solo puede haber un reaprovisionamiento activo por tenant destino en un momento dado. Los intentos concurrentes se rechazan con `409 Conflict`. El lock se libera al completar (éxito o fallo) o tras un timeout configurable.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T03-01 — Endpoint de reaprovisionamiento de configuración funcional**
Debe existir un endpoint REST que, dado un `tenant_id` destino, un artefacto de exportación (body JSON), un mapa de identificadores (opcional), una lista de dominios a aplicar (opcional), y un flag `dry_run` (opcional), ejecute el reaprovisionamiento de la configuración funcional del tenant destino a partir del artefacto.

**RF-T03-02 — Validación previa del artefacto**
Antes de ejecutar cualquier aplicador, el endpoint debe validar que el artefacto tiene una `format_version` compatible con la versión actual del formato (mismo major version). Si no es compatible, debe rechazar con `422` indicando que el artefacto debe migrarse primero.

**RF-T03-03 — Generación del mapa de identificadores**
Cuando el `tenant_id` del artefacto difiere del tenant destino, el sistema debe generar un mapa propuesto de reemplazos de identificadores que incluya al menos: realm IAM, schema/database PostgreSQL, database MongoDB, prefijo de topics Kafka, namespace de funciones, y prefijo de buckets S3. El operador puede confirmar el mapa tal cual o proporcionar uno modificado.

**RF-T03-04 — Endpoint de generación de mapa de identificadores**
Debe existir un endpoint auxiliar REST que, dado un artefacto y un `tenant_id` destino, devuelva el mapa propuesto de identificadores sin ejecutar ningún cambio. Esto permite la revisión previa del mapa en herramientas o UIs.

**RF-T03-05 — Aplicador de configuración IAM (Keycloak)**
Debe existir un aplicador que, a partir de la sección IAM del artefacto (con identificadores ya ajustados), cree o verifique en el tenant destino: roles, grupos, client scopes, identity providers y mappers. Si un recurso ya existe con la misma configuración, lo omite (`skipped`). Si existe con configuración diferente, lo reporta como `conflict`.

**RF-T03-06 — Aplicador de metadata PostgreSQL**
Debe existir un aplicador que, a partir de la sección PostgreSQL del artefacto, cree o verifique en el tenant destino: esquemas, tablas (estructura, columnas, tipos, constraints, índices), vistas, extensiones y grants. No incluye datos de las tablas.

**RF-T03-07 — Aplicador de metadata MongoDB**
Debe existir un aplicador que, a partir de la sección MongoDB del artefacto, cree o verifique en el tenant destino: bases de datos, colecciones (con validadores/schemas), índices, y configuración de sharding si aplica. No incluye documentos.

**RF-T03-08 — Aplicador de topics y ACLs de Kafka**
Debe existir un aplicador que, a partir de la sección Kafka del artefacto, cree o verifique en el tenant destino: topics (con configuración de particiones, replicación y retention), ACLs y consumer groups. No incluye mensajes.

**RF-T03-09 — Aplicador de funciones OpenWhisk**
Debe existir un aplicador que, a partir de la sección de funciones del artefacto, cree o verifique en el tenant destino: acciones (con runtime, código fuente o referencia, y límites), paquetes, triggers y rules. Los secretos redactados no se aplican; se crea el recurso sin ellos y se reporta como `applied_with_warnings`.

**RF-T03-10 — Aplicador de buckets y políticas S3**
Debe existir un aplicador que, a partir de la sección S3 del artefacto, cree o verifique en el tenant destino: buckets (con versionado, lifecycle rules), políticas de acceso y configuración CORS. No incluye objetos almacenados.

**RF-T03-11 — Modo dry-run**
El endpoint debe aceptar un flag `dry_run` (booleano). Cuando está activo, el sistema recorre todos los aplicadores pero no ejecuta cambios reales. Cada aplicador evalúa qué recursos se crearían, cuáles se omitirían y cuáles generarían conflictos, y devuelve el plan de aplicación sin modificar ningún subsistema.

**RF-T03-12 — Filtrado por dominios en la aplicación**
El endpoint debe aceptar un parámetro opcional que indique qué dominios del artefacto aplicar. Si no se especifica, se aplican todos los dominios con status `ok` o `empty`. Los dominios con status `error`, `not_available` o `not_requested` se omiten siempre.

**RF-T03-13 — Degradación parcial ante fallo de aplicador**
Si un aplicador falla (timeout, error de conexión, error interno), el reaprovisionamiento continúa con los demás dominios. El dominio fallido aparece con `"status": "error"` y un mensaje descriptivo en el resultado. El reaprovisionamiento no se aborta por el fallo de un solo dominio.

**RF-T03-14 — Resultado detallado por dominio y por recurso**
El endpoint debe devolver un resultado estructurado que incluya, por cada dominio: status general (`applied`, `applied_with_warnings`, `skipped`, `error`), número de recursos creados, omitidos y en conflicto, y un detalle por recurso con su nombre/identificador, acción realizada (`created`, `skipped`, `conflict`, `error`, `applied_with_warnings`), y mensaje descriptivo si aplica.

**RF-T03-15 — Lock de concurrencia por tenant**
El sistema debe impedir reaprovisionamientos concurrentes sobre el mismo tenant destino. Si ya hay uno en curso, el endpoint debe devolver `HTTP 409` con mensaje indicando el reaprovisionamiento activo. El lock se libera al finalizar o tras un timeout configurable.

**RF-T03-16 — Sustitución transversal de identificadores**
Antes de que los aplicadores operen, el sistema debe aplicar el mapa de identificadores al artefacto completo, reemplazando todas las ocurrencias de cada identificador de origen por su valor destino en todos los campos de texto del artefacto. La sustitución es transversal a todos los dominios.

### 4.2 Límites claros de alcance

**Incluido en US-BKP-02-T03:**

- Endpoint de reaprovisionamiento de configuración funcional (API REST).
- Seis aplicadores de configuración: IAM, PostgreSQL metadata, MongoDB metadata, Kafka topics/ACLs, OpenWhisk funciones, S3 buckets/políticas.
- Generación y aplicación del mapa de identificadores.
- Endpoint auxiliar de generación del mapa de identificadores.
- Modo dry-run.
- Filtrado por dominios.
- Degradación parcial ante fallos de aplicadores.
- Resultado detallado por dominio y recurso.
- Lock de concurrencia por tenant.
- Detección de conflictos de recursos (report, no resolución automática).

**Excluido (tareas hermanas u otros):**

- Resolución automática de conflictos y políticas de merge → **US-BKP-02-T04** (validaciones previas).
- Pruebas de restauración funcional en sandbox → **US-BKP-02-T05**.
- Documentación de diferencias entre restauración de config y de datos → **US-BKP-02-T06**.
- Creación de tenants → **US-TEN-04** (el tenant destino debe existir previamente).
- Restauración de datos de usuario → fuera del scope de US-BKP-02 (la historia trata configuración funcional, no datos).
- Rollback automático de dominios aplicados ante fallo de otro dominio → no incluido; el reaprovisionamiento no es transaccional cross-domain.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- El reaprovisionamiento opera sobre un único `tenant_id` destino. Un actor solo puede reaprovisionar un tenant para el cual tiene autorización.
- Los aplicadores acceden a cada subsistema en el scope del tenant destino. Los identificadores del artefacto de origen se sustituyen por los del destino antes de que los aplicadores operen.
- No existe reaprovisionamiento masivo de múltiples tenants en una sola invocación.
- El artefacto de origen puede provenir de cualquier tenant (incluso de otro entorno), pero solo se aplica sobre el tenant destino autorizado.

### 5.2 Permisos de acceso

| Actor | Puede reaprovisionar un tenant | Puede generar mapa de identificadores | Puede ejecutar dry-run |
|---|---|---|---|
| Tenant owner | ❌ No (en esta fase) | ❌ No | ❌ No |
| SRE / Platform team | ✅ Sí | ✅ Sí | ✅ Sí |
| Superadmin | ✅ Sí | ✅ Sí | ✅ Sí |
| Proceso interno (automatización DR) | ✅ Sí (con credencial de servicio) | ✅ Sí | ✅ Sí |

> **Nota**: El reaprovisionamiento es una operación de alto impacto que modifica la configuración funcional de un tenant. Mantiene los mismos permisos privilegiados que la exportación (T01) y la validación/migración (T02).

### 5.3 Auditoría

- Cada invocación del endpoint de reaprovisionamiento debe generar un evento de auditoría que registre: actor, `tenant_id` destino, `tenant_id` origen (del artefacto), dominios solicitados, dominios aplicados con su resultado individual, modo (dry-run o efectivo), número total de recursos creados/omitidos/conflictos/errores, timestamp y correlation-id.
- Cada invocación del endpoint de generación de mapa de identificadores debe generar un evento de auditoría con: actor, tenant destino, tenant origen, timestamp y correlation-id.
- Los eventos de auditoría se envían al pipeline estándar de la plataforma (US-OBS-01).
- En modo dry-run, el evento de auditoría incluye `"mode": "dry_run"` para distinguirlo de las ejecuciones efectivas.

### 5.4 Seguridad

- El endpoint de reaprovisionamiento requiere autenticación (token JWT de Keycloak) y autorización por rol.
- Los aplicadores acceden a los subsistemas con credenciales de servicio con permisos de escritura sobre el scope del tenant destino. Estas credenciales son distintas de las de solo lectura usadas por los recolectores de T01.
- El artefacto enviado para reaprovisionamiento no se almacena en la plataforma; se procesa en memoria. El resultado y los eventos de auditoría se persisten.
- Los secretos redactados en el artefacto no se aplican ni se transmiten a los subsistemas.
- Las respuestas de error del endpoint no revelan detalles internos de los subsistemas (credenciales, conexiones internas, rutas de red).
- El lock de concurrencia previene condiciones de carrera que podrían dejar un tenant en estado inconsistente.

### 5.5 Trazabilidad con el backlog

| Requisito funcional | RF del backlog |
|---|---|
| Reaprovisionamiento de configuración funcional a partir de export | RF-BKP-003 |
| Aplicadores por dominio y resultado detallado | RF-BKP-004 |

---

## User Scenarios & Testing

### User Story 1 — Reaprovisionamiento completo de tenant vacío (Priority: P1)

Un SRE necesita reconstruir la configuración completa de un tenant tras un incidente. Tiene un artefacto de exportación reciente del tenant afectado y un tenant nuevo y vacío ya creado en la plataforma. Sube el artefacto al endpoint de reaprovisionamiento, revisa el mapa de identificadores propuesto, confirma la aplicación, y obtiene la configuración funcional restaurada en todos los dominios disponibles.

**Why this priority**: Es el caso de uso fundamental que justifica la existencia de esta tarea. Sin él, el artefacto de exportación no tiene utilidad operativa para recuperación.

**Independent Test**: Dado un artefacto con los seis dominios en status `ok` y un tenant vacío, el reaprovisionamiento crea recursos en todos los dominios y el resultado muestra todos los dominios con status `applied`.

**Acceptance Scenarios**:

1. **Given** un artefacto completo (6 dominios, status `ok`) y un tenant vacío, **When** un superadmin ejecuta el reaprovisionamiento sin filtro de dominios con el mapa de identificadores confirmado, **Then** todos los dominios se aplican con status `applied`, cada recurso del artefacto se crea en el tenant destino, y se genera un evento de auditoría con el detalle.
2. **Given** un artefacto con `format_version` compatible y un tenant vacío, **When** se ejecuta el reaprovisionamiento, **Then** los recursos creados en el destino reflejan la configuración del artefacto con los identificadores del destino (no los del origen).

---

### User Story 2 — Dry-run antes de la aplicación efectiva (Priority: P1)

Un SRE quiere evaluar el impacto de un reaprovisionamiento antes de ejecutarlo. Envía el artefacto al endpoint con `dry_run: true` y obtiene un plan detallado de qué se crearía, qué se omitiría y qué conflictos se detectarían, sin modificar el tenant destino.

**Why this priority**: El dry-run es esencial para la confianza operativa. Permite validar el resultado esperado antes de comprometer cambios en un sistema productivo.

**Independent Test**: Dado un artefacto y un tenant con alguna configuración existente, el dry-run devuelve un plan con recursos `would_create`, `would_skip` y `would_conflict` sin que el estado del tenant cambie.

**Acceptance Scenarios**:

1. **Given** un artefacto completo y un tenant con algunos recursos ya existentes, **When** un SRE ejecuta el reaprovisionamiento con `dry_run: true`, **Then** el resultado lista los recursos que se crearían, los que se omitirían y los conflictos detectados, y el estado del tenant destino no ha cambiado.
2. **Given** un dry-run exitoso, **When** se inspecciona el resultado, **Then** cada dominio tiene un desglose de recursos con acción propuesta (`would_create`, `would_skip`, `would_conflict`) y mensaje descriptivo.

---

### User Story 3 — Ajuste manual de identificadores entre entornos (Priority: P1)

Un superadmin quiere clonar la configuración de un tenant de staging en un tenant de producción. Los identificadores internos (realm, schema, prefijos) difieren entre entornos. El sistema genera un mapa de reemplazos propuesto que el operador revisa, ajusta un valor, y luego ejecuta el reaprovisionamiento con el mapa corregido.

**Why this priority**: Sin ajuste de identificadores, el artefacto de un entorno no puede aplicarse en otro. Es un requisito fundamental para migración cross-environment y clonación de tenants.

**Independent Test**: Dado un artefacto de `tenant-stg` y un tenant destino `tenant-prod`, la generación del mapa propone reemplazos para realm, schema, prefijos de topics, namespace de funciones y prefijo de buckets. Tras la aplicación con el mapa, los recursos en el destino usan los identificadores del destino.

**Acceptance Scenarios**:

1. **Given** un artefacto exportado del tenant `tenant-stg` con realm `stg-abc`, **When** un superadmin solicita el mapa de identificadores para el tenant destino `tenant-prod`, **Then** el sistema devuelve un mapa con propuestas de reemplazo: `stg-abc → prod-xyz`, `stg_abc → prod_xyz` (schema), etc.
2. **Given** un mapa de identificadores revisado por el operador, **When** se ejecuta el reaprovisionamiento con el mapa, **Then** todas las referencias del artefacto usan los identificadores del destino y no queda ninguna referencia al origen.

---

### User Story 4 — Reaprovisionamiento parcial por dominio (Priority: P2)

Un SRE necesita restaurar solo la configuración de IAM y funciones de un tenant, sin afectar los demás dominios. Envía el artefacto completo pero especifica `domains: ["iam", "functions"]`.

**Why this priority**: Permite recuperaciones quirúrgicas que no afectan dominios no impactados, reduciendo el riesgo operativo.

**Independent Test**: Dado un artefacto completo y un filtro de dominios, solo los dominios indicados se procesan y los demás no se modifican.

**Acceptance Scenarios**:

1. **Given** un artefacto con 6 dominios y un filtro `["iam", "functions"]`, **When** se ejecuta el reaprovisionamiento, **Then** solo IAM y funciones aparecen en el resultado con status `applied` o `skipped`, y los demás dominios no aparecen en el resultado ni se modifican en el tenant destino.

---

### User Story 5 — Detección de conflictos en tenant con configuración existente (Priority: P2)

Un operador aplica un artefacto sobre un tenant que ya tiene configuración parcial. El resultado identifica los recursos que coinciden (omitidos), los que no existen (creados) y los que existen con configuración diferente (conflictos).

**Why this priority**: La mayoría de los reaprovisionamientos del mundo real se hacen sobre tenants no vacíos. La detección de conflictos es esencial para evitar la sobreescritura accidental.

**Independent Test**: Dado un tenant con un rol IAM `editor` con ciertos permisos, y un artefacto que contiene un rol `editor` con permisos diferentes, el resultado muestra ese recurso como `conflict`.

**Acceptance Scenarios**:

1. **Given** un tenant con un rol `editor` (permisos A, B) y un artefacto con rol `editor` (permisos A, C), **When** se ejecuta el reaprovisionamiento, **Then** el rol `editor` aparece como `conflict` con detalle de la diferencia y no se modifica.
2. **Given** un tenant con un topic `events` y un artefacto con el mismo topic con la misma configuración, **When** se ejecuta, **Then** el topic aparece como `skipped` (ya existe y es equivalente).

---

### User Story 6 — Manejo de secretos redactados (Priority: P3)

Un artefacto exportado contiene funciones con variables de entorno cuyos valores son `***REDACTED***`. Al reaprovisionar, las funciones se crean pero sin los secretos, y el resultado indica explícitamente qué recursos necesitan configuración manual de secretos.

**Why this priority**: Es un caso inevitable dado que la exportación redacta secretos (RN-05 de T01). El operador necesita visibilidad de qué queda pendiente.

**Independent Test**: Dado un artefacto con una función cuya variable `DB_PASSWORD` es `***REDACTED***`, tras el reaprovisionamiento la función existe sin esa variable configurada y el resultado la reporta como `applied_with_warnings`.

**Acceptance Scenarios**:

1. **Given** un artefacto con una función que tiene `DB_PASSWORD: "***REDACTED***"`, **When** se ejecuta el reaprovisionamiento, **Then** la función se crea en el destino sin la variable `DB_PASSWORD` (o con un placeholder explícito), el recurso aparece como `applied_with_warnings`, y el warning indica que los secretos deben configurarse manualmente.

---

### Edge Cases

- ¿Qué ocurre si el artefacto tiene dominios con status `not_available` o `error`? → Se omiten del reaprovisionamiento con status `skipped_not_exportable`.
- ¿Qué pasa si dos operadores inician reaprovisionamiento del mismo tenant simultáneamente? → El segundo recibe `HTTP 409 Conflict`.
- ¿Qué ocurre si un artefacto de versión de formato antigua se envía sin migrar? → Rechazado con `HTTP 422` indicando que debe migrarse primero.
- ¿Qué pasa si el mapa de identificadores omite una entrada necesaria? → El sistema detecta que quedan identificadores del origen en el artefacto transformado y advierte al operador antes de proceder.
- ¿Qué ocurre si el tenant destino se elimina durante el reaprovisionamiento? → Los aplicadores que fallen por tenant inexistente se reportan como `error`; los ya completados mantienen sus efectos.

---

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE permitir reaprovisionar la configuración funcional de un tenant destino a partir de un artefacto de exportación válido (RF-T03-01).
- **FR-002**: El sistema DEBE validar el `format_version` del artefacto antes de ejecutar el reaprovisionamiento, rechazando artefactos incompatibles con la versión actual (RF-T03-02).
- **FR-003**: El sistema DEBE generar un mapa propuesto de reemplazo de identificadores cuando el tenant de origen difiere del destino (RF-T03-03).
- **FR-004**: El sistema DEBE proveer un endpoint auxiliar para obtener el mapa de identificadores sin ejecutar cambios (RF-T03-04).
- **FR-005**: El sistema DEBE soportar seis aplicadores independientes: IAM, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3 (RF-T03-05 a RF-T03-10).
- **FR-006**: El sistema DEBE soportar modo dry-run que simula el reaprovisionamiento sin modificar el tenant destino (RF-T03-11).
- **FR-007**: El sistema DEBE permitir filtrar qué dominios del artefacto se aplican (RF-T03-12).
- **FR-008**: El sistema DEBE continuar con los demás dominios cuando un aplicador falla, sin abortar todo el reaprovisionamiento (RF-T03-13).
- **FR-009**: El sistema DEBE devolver un resultado detallado por dominio y por recurso con la acción realizada (RF-T03-14).
- **FR-010**: El sistema DEBE impedir reaprovisionamientos concurrentes sobre el mismo tenant destino (RF-T03-15).
- **FR-011**: El sistema DEBE sustituir los identificadores del artefacto de origen por los del destino de forma transversal antes de que los aplicadores operen (RF-T03-16).
- **FR-012**: El sistema NO DEBE sobrescribir automáticamente recursos que existen con configuración diferente; debe reportarlos como conflictos (RN-T03-05).
- **FR-013**: El sistema NO DEBE aplicar valores de secretos redactados (`***REDACTED***`); debe reportar los recursos afectados como `applied_with_warnings` (RN-T03-07).

### Key Entities

- **Export Artifact**: Artefacto JSON producido por T01, validado y opcionalmente migrado por T02. Contiene la configuración funcional de un tenant organizada por dominios. Es el input del reaprovisionamiento.
- **Identifier Map**: Diccionario de reemplazos `{ origen → destino }` que traduce identificadores del tenant/entorno de origen a los del destino. Incluye realm, schema, prefijos de topics, namespaces, prefijos de buckets.
- **Applier (Aplicador)**: Componente por dominio que sabe cómo leer la sección correspondiente del artefacto y crear/verificar los recursos en el subsistema destino.
- **Reprovision Result**: Estructura de resultado que contiene el status general, el desglose por dominio y el detalle por recurso individual.
- **Concurrency Lock**: Mecanismo de exclusión mutua por `tenant_id` destino que impide reaprovisionamientos concurrentes.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Un operador puede reconstruir la configuración funcional completa de un tenant vacío a partir de un artefacto de exportación en una única operación, sin necesidad de interactuar con cada subsistema individualmente.
- **SC-002**: El modo dry-run produce un plan de aplicación completo en menos de 30 segundos para un tenant con configuración estándar (hasta 50 recursos por dominio).
- **SC-003**: El mapa de identificadores cubre todos los tipos de referencia entre artefacto de origen y tenant destino, sin que queden identificadores del origen en la configuración aplicada al destino.
- **SC-004**: Los conflictos de recursos se detectan y se reportan antes de que cualquier cambio automático se aplique sobre un recurso existente (zero sobrescritura silenciosa).
- **SC-005**: El resultado del reaprovisionamiento permite al operador identificar en menos de 1 minuto qué se aplicó, qué se omitió, qué conflictos existen y qué secretos necesitan configuración manual.
- **SC-006**: Dos reaprovisionamientos concurrentes sobre el mismo tenant nunca se ejecutan simultáneamente; el segundo recibe un rechazo claro.

---

## 6. Criterios de aceptación

**CA-01 — Reaprovisionamiento completo de tenant vacío**
Dado un artefacto con los seis dominios en status `ok` y un tenant destino vacío, cuando un superadmin ejecuta el reaprovisionamiento con el mapa de identificadores confirmado, entonces el resultado muestra los seis dominios con status `applied` y los recursos del artefacto están presentes en el tenant destino con los identificadores del destino.

**CA-02 — Validación de format_version antes de aplicar**
Dado un artefacto con `format_version` de un major anterior al actual, cuando se envía al endpoint de reaprovisionamiento, entonces se rechaza con `HTTP 422` indicando que debe migrarse primero. No se ejecuta ningún aplicador.

**CA-03 — Generación del mapa de identificadores**
Dado un artefacto exportado del tenant A y un tenant destino B, cuando se solicita el mapa de identificadores, entonces el sistema devuelve un mapa con al menos: realm/namespace IAM, schema/database PostgreSQL, database MongoDB, prefijo de topics Kafka, namespace de funciones, y prefijo de buckets S3, con valores propuestos para el destino.

**CA-04 — Mapa de identificadores aplicado transversalmente**
Dado un mapa de identificadores `{ "stg_abc": "prod_xyz" }` y un artefacto con referencias a `stg_abc` en múltiples dominios, cuando se ejecuta el reaprovisionamiento, entonces ningún recurso creado en el destino contiene la cadena `stg_abc`.

**CA-05 — Modo dry-run no modifica el tenant destino**
Dado un artefacto y un tenant destino, cuando se ejecuta con `dry_run: true`, entonces el resultado contiene un plan detallado con acciones propuestas (`would_create`, `would_skip`, `would_conflict`) y el estado del tenant destino no ha cambiado (verificable antes y después del dry-run).

**CA-06 — Filtrado por dominios**
Dado un artefacto con 6 dominios y un filtro `["iam", "functions"]`, cuando se ejecuta el reaprovisionamiento, entonces solo IAM y funciones se procesan. Los demás dominios no aparecen en el resultado ni se modifican en el destino.

**CA-07 — Degradación parcial ante fallo de aplicador**
Dado un aplicador de MongoDB que falla por timeout, cuando se ejecuta el reaprovisionamiento completo, entonces los demás dominios se aplican normalmente y MongoDB aparece con `status: "error"` y mensaje descriptivo. El endpoint no devuelve `HTTP 500`.

**CA-08 — Detección de conflictos sin sobrescritura**
Dado un tenant destino con un rol IAM `editor` con ciertos permisos, y un artefacto con el mismo rol con permisos diferentes, cuando se ejecuta el reaprovisionamiento, entonces el rol aparece como `conflict` con detalle de la diferencia y no se ha modificado en el destino.

**CA-09 — Recursos idénticos se omiten (skipped)**
Dado un tenant destino con un topic Kafka `events` con la misma configuración que en el artefacto, cuando se ejecuta el reaprovisionamiento, entonces el topic aparece como `skipped` y no se modifica.

**CA-10 — Secretos redactados no se aplican**
Dado un artefacto con una función cuya variable de entorno `DB_PASSWORD` es `***REDACTED***`, cuando se ejecuta el reaprovisionamiento, entonces la función se crea sin esa variable (o con un marcador explícito), el recurso aparece como `applied_with_warnings`, y el warning indica que los secretos deben configurarse manualmente.

**CA-11 — Lock de concurrencia por tenant**
Dado un reaprovisionamiento en curso sobre el tenant X, cuando otro actor intenta un reaprovisionamiento sobre el mismo tenant X, entonces recibe `HTTP 409 Conflict` con mensaje indicando el reaprovisionamiento activo.

**CA-12 — Dominio no exportable se omite**
Dado un artefacto con un dominio en status `not_available`, cuando se ejecuta el reaprovisionamiento, entonces ese dominio aparece como `skipped_not_exportable` en el resultado y no se intenta aplicar.

**CA-13 — Tenant destino inexistente**
Dado un `tenant_id` destino que no existe en la plataforma, cuando se invoca el endpoint de reaprovisionamiento, entonces se devuelve `HTTP 404`.

**CA-14 — Autorización: solo roles privilegiados**
Dado un tenant owner autenticado, cuando intenta invocar el endpoint de reaprovisionamiento, entonces recibe `HTTP 403`. Dado un superadmin, la misma invocación procede normalmente.

**CA-15 — Evento de auditoría por reaprovisionamiento**
Dado un reaprovisionamiento exitoso o parcialmente exitoso, cuando se completa, entonces existe un evento de auditoría en el pipeline con: actor, tenant_id destino, tenant_id origen, dominios solicitados, resultado por dominio, modo (dry-run o efectivo), número de recursos creados/omitidos/conflictos/errores, timestamp y correlation-id.

**CA-16 — Resultado detallado por recurso**
Dado un reaprovisionamiento completado, cuando se inspecciona el resultado de un dominio, entonces cada recurso individual aparece con: nombre/identificador, acción realizada (`created`, `skipped`, `conflict`, `error`, `applied_with_warnings`), y mensaje descriptivo si aplica.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | Los aplicadores requieren credenciales de servicio con permisos de escritura en cada subsistema, lo cual puede no estar uniformemente configurado en todos los entornos | Media | Alto | Verificar disponibilidad de credenciales de escritura antes de implementar cada aplicador. Degradar a `not_available` si no hay acceso de escritura. |
| R-02 | La detección de equivalencia entre un recurso del artefacto y uno existente en el destino puede ser compleja (p. ej., comparar esquemas PostgreSQL completos o roles IAM con permisos anidados) | Alta | Medio | Definir criterios de equivalencia conservadores y bien documentados por tipo de recurso. Aceptar falsos positivos de `conflict` (reportar como conflicto algo que en realidad es idéntico) sobre falsos negativos (considerar idéntico algo que difiere). |
| R-03 | La sustitución transversal de identificadores con búsqueda y reemplazo de texto puede producir reemplazos no deseados si un identificador es subcadena de otro | Media | Alto | El mapa de identificadores debe aplicarse con reemplazo de cadena completa (word-boundary o match exacto), no con `replaceAll` ingenuo. Los aplicadores deben verificar post-sustitución. |
| R-04 | El reaprovisionamiento de funciones OpenWhisk con código fuente puede ser pesado si el artefacto incluye muchas funciones con código inline | Media | Medio | Aplicar timeout configurable por aplicador. Documentar que funciones muy grandes pueden requerir reaprovisionamiento parcial (solo dominio `functions`). |
| R-05 | Sin rollback cross-domain, un fallo parcial puede dejar el tenant en un estado mixto (algunos dominios aprovisionados, otros no) | Media | Medio | Documentar claramente que el reaprovisionamiento no es transaccional. Recomendar dry-run previo. Permitir reintentar solo dominios fallidos. El resultado detallado permite al operador evaluar el estado. |

### 7.2 Supuestos

**S-01**: El tenant destino existe y ha sido creado previamente por US-TEN-04. El reaprovisionamiento no crea tenants.

**S-02**: Las convenciones de identificadores por subsistema (realm para Keycloak, schema para PostgreSQL, database para MongoDB, prefijo de topics para Kafka, namespace para OpenWhisk, prefijo de buckets para S3) son conocidas y pueden derivarse del `tenant_id` destino o configurarse en el mapa de identificadores.

**S-03**: Los recolectores de T01 producen artefactos con suficiente detalle para que los aplicadores puedan reconstruir la configuración. Si un recolector omite información necesaria para la recreación, el aplicador correspondiente reportará el recurso como `error` con detalle.

**S-04**: Las APIs de administración de cada subsistema soportan operaciones de creación (no solo lectura) con las credenciales de servicio configuradas.

**S-05**: El pipeline de auditoría (US-OBS-01) acepta eventos de reaprovisionamiento con la misma interfaz usada por la exportación en T01 y la validación/migración en T02.

**S-06**: El modo dry-run puede evaluar la existencia y equivalencia de recursos en el destino sin ejecutar cambios. Esto requiere acceso de lectura a los subsistemas del tenant destino.

### 7.3 Preguntas abiertas

**P-01 — ¿Los aplicadores deben soportar actualización de recursos existentes cuando hay conflicto, o solo creación?**
En esta especificación, los conflictos se reportan sin resolución automática. ¿Debería existir un flag `force: true` que sobrescriba? Esto tiene implicaciones de seguridad significativas.
*No bloquea la especificación*; puede resolverse como refinamiento o en US-BKP-02-T04.

**P-02 — ¿El reaprovisionamiento debe ser síncrono o asíncrono?**
Para tenants con configuración extensa, el reaprovisionamiento podría tardar más de lo aceptable para una respuesta HTTP síncrona. ¿Se debe ofrecer un mecanismo asíncrono (iniciar → poll estado → obtener resultado)?
*No bloquea la especificación*; puede resolverse en plan/implementación.

**P-03 — ¿Cómo se derivan los identificadores del tenant destino si no se proporcionan explícitamente?**
¿Existe una función centralizada que dado un `tenant_id` devuelve realm, schema, prefijo de topics, etc.? ¿O cada subsistema usa convenciones independientes?
*No bloquea la especificación*; el mapa de identificadores cubre este caso permitiendo que el operador ajuste cualquier valor.

---

## Assumptions

- El artefacto de exportación (T01) contiene toda la información funcional necesaria para reconstruir la configuración de un tenant. Los campos y estructura ya están documentados en las especificaciones de T01 y T02.
- Los subsistemas de la plataforma (Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3) permiten la creación programática de recursos a través de sus APIs de administración.
- El operador tiene conocimiento suficiente para revisar y ajustar el mapa de identificadores cuando los valores propuestos no son correctos.
- Las variables de entorno para credenciales de escritura a cada subsistema seguirán la convención `CONFIG_IMPORT_*` análoga a las `CONFIG_EXPORT_*` de T01.

---

*Documento generado para el stage `speckit.specify` — US-BKP-02-T03 | Rama: `117-tenant-reprovision-from-export`*
