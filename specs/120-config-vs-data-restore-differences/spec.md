# Especificación — US-BKP-02-T06: Documentar diferencias entre restauración de configuración y restauración de datos

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-02-T06                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-02 — Exportación de configuración funcional y reprovisionamiento de tenants |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-003, RF-BKP-004                                               |
| **Dependencias**    | US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02, US-BKP-02-T03, US-BKP-02-T04, US-BKP-02-T05 |

**Feature Branch**: `120-config-vs-data-restore-differences`
**Created**: 2026-04-01
**Status**: Draft

---

## 1. Objetivo y problema que resuelve

### Problema

Las tareas US-BKP-02-T01 a T05 construyen la cadena completa de exportación, formato versionado, reaprovisionamiento, validación previa de conflictos y pruebas funcionales para la **configuración funcional** de tenants. Sin embargo, esta cadena opera exclusivamente sobre configuración (roles IAM, esquemas de tablas, topics, funciones, políticas de buckets) y **no restaura datos de usuario** (filas de tablas, documentos, mensajes en topics, objetos almacenados en buckets).

Sin una documentación explícita de esta distinción:

1. **Los operadores pueden asumir erróneamente que el reaprovisionamiento restaura datos.** Un SRE que ejecuta un reaprovisionamiento a partir de un artefacto de exportación podría esperar que las tablas PostgreSQL se restauren con sus filas, que los topics Kafka contengan sus mensajes, o que los buckets S3 tengan sus objetos. Ninguna de estas expectativas se cumple: el reaprovisionamiento solo recrea la estructura y metadatos, no el contenido.

2. **No existe un documento de referencia que delimite qué cubre cada tipo de restauración.** Los procedimientos de Disaster Recovery (DR) necesitan distinguir claramente entre restaurar la configuración (lo que cubre US-BKP-02) y restaurar los datos (lo que requiere mecanismos distintos: backups de PostgreSQL, snapshots de MongoDB, retención de mensajes en Kafka, replicación de objetos S3). Sin esta delimitación, los runbooks de DR pueden tener lagunas.

3. **Los tenant owners y superadmins carecen de visibilidad sobre el alcance real de la restauración funcional.** Cuando se les comunica que "la configuración de su tenant se puede restaurar", pueden interpretar que toda la información del tenant es recuperable. La ausencia de documentación clara genera expectativas incorrectas y riesgo reputacional en caso de incidente.

4. **Las decisiones de inversión en capacidades de backup de datos no tienen un marco de referencia.** Sin documentar explícitamente qué datos NO se restauran con la cadena actual, es difícil priorizar y justificar el desarrollo de capacidades complementarias de backup de datos para cada subsistema.

### Objetivo de esta tarea

Producir una documentación operativa estructurada que describa de forma inequívoca las diferencias entre la restauración de configuración funcional (cubierta por US-BKP-02-T01 a T05) y la restauración de datos de usuario (no cubierta), dominio por dominio, incluyendo qué elementos se restauran, cuáles no, qué mecanismos alternativos existen o se necesitan para los datos, y qué expectativas deben establecerse con los distintos actores.

El resultado es que los operadores, superadmins, tenant owners y el equipo de plataforma dispongan de un documento de referencia claro y accionable que:
- Delimite el alcance exacto de la restauración de configuración por dominio.
- Identifique explícitamente qué datos de usuario quedan fuera y por qué.
- Describa los mecanismos complementarios necesarios para la restauración de datos.
- Establezca las expectativas correctas para cada actor del sistema.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Utiliza la documentación como referencia en procedimientos de DR y runbooks | Claridad sobre qué pasos cubren la restauración de configuración y qué pasos adicionales necesita para restaurar datos. Evita asumir que el reaprovisionamiento es una restauración completa. |
| **Superadmin** | Consulta la documentación para comunicar el alcance de recuperación a stakeholders | Puede informar con precisión qué es restaurable automáticamente (configuración) y qué requiere procedimientos adicionales (datos), reduciendo el riesgo de comunicar expectativas incorrectas. |
| **Tenant owner** | Consumidor indirecto; recibe comunicaciones basadas en esta documentación | Expectativas correctas sobre qué se puede y qué no se puede recuperar de su tenant en caso de incidente. Puede tomar decisiones informadas sobre sus propias estrategias de backup de datos. |
| **Equipo de producto / Platform team** | Utiliza la documentación para identificar gaps de cobertura y priorizar futuras capacidades | Un inventario claro de qué datos no tienen cobertura de restauración sirve como input directo para la priorización de futuras historias de backup de datos por subsistema. |
| **QA / Auditoría** | Verifica que las pruebas de restauración (T05) cubren lo documentado y no más | La documentación actúa como contrato verificable: las pruebas de T05 deben validar exactamente lo que este documento declara como restaurable. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Un SRE consulta la documentación antes de ejecutar un procedimiento de DR**

> Un SRE necesita restaurar un tenant afectado por un incidente. Antes de ejecutar el reaprovisionamiento, consulta la documentación de diferencias para entender qué aspectos del tenant se restaurarán automáticamente (configuración funcional) y qué aspectos requieren pasos adicionales (datos de usuario). Con esta información, planifica un procedimiento de DR completo que combina el reaprovisionamiento de configuración con la restauración de datos desde backups de cada subsistema.

**E2 — Un superadmin comunica el alcance de recuperación a un tenant owner tras un incidente**

> Un tenant owner solicita información sobre la capacidad de recuperación de su tenant. El superadmin consulta la documentación y puede explicar: "La estructura completa de tu tenant (roles, permisos, esquemas de tablas, topics, funciones, políticas de almacenamiento) se puede restaurar automáticamente a partir de la última exportación de configuración. Los datos contenidos en tus tablas, documentos, mensajes y objetos almacenados requieren restauración desde los backups de cada subsistema, que se gestionan por separado."

**E3 — El equipo de producto prioriza capacidades futuras de backup de datos**

> El product manager revisa la documentación de diferencias para identificar qué subsistemas carecen de capacidades de backup de datos automatizado. La documentación muestra, dominio por dominio, qué mecanismos de backup de datos existen actualmente (nativos del subsistema o de la plataforma) y cuáles son gaps. Esta información se usa como input para priorizar epics de backup de datos en el roadmap.

**E4 — Un auditor verifica la coherencia entre documentación, pruebas y capacidades**

> Un auditor de continuidad operativa revisa la documentación y la contrasta con las pruebas de T05 y las capacidades de T01-T04. Verifica que: lo que la documentación declara como restaurable por configuración coincide con lo que las pruebas validan; lo que la documentación declara como fuera de alcance no se promete en ningún otro documento o interfaz del producto.

**E5 — Un nuevo miembro del equipo de plataforma se incorpora y necesita entender el modelo de restauración**

> Un nuevo SRE se incorpora al equipo y necesita entender rápidamente qué puede y qué no puede restaurar la plataforma. La documentación de diferencias le proporciona una vista consolidada, dominio por dominio, del alcance de la restauración de configuración y de los mecanismos complementarios para datos, sin necesidad de leer las especificaciones de T01 a T05 individualmente.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Un dominio opcional está deshabilitado en el entorno (ej: MongoDB con `CONFIG_EXPORT_MONGO_ENABLED=false`) | La documentación debe reflejar que los dominios opcionales pueden no estar disponibles para exportación ni restauración en ciertos despliegues, y que esto afecta tanto a la configuración como a los datos de ese dominio. |
| Un subsistema tiene backup nativo pero no integrado en la plataforma (ej: pg_dump externo) | La documentación debe distinguir entre mecanismos de backup de datos nativos del subsistema (gestionados fuera de la plataforma) y mecanismos integrados en la plataforma (si los hubiera). |
| Secretos redactados en la exportación de configuración | La documentación debe mencionar que los secretos se redactan en la exportación de configuración y que su restauración requiere configuración manual post-reaprovisionamiento. Esto es una limitación transversal que afecta la completitud de la restauración de configuración. |
| Datos efímeros (ej: mensajes en un topic Kafka con retention expirado) | La documentación debe señalar que ciertos datos son efímeros por diseño y no son restaurables aunque exista un mecanismo de backup, si la ventana de retención ha expirado. |
| Configuración generada dinámicamente (ej: consumer groups creados por aplicaciones) | La documentación debe distinguir entre configuración declarativa (restaurable) y configuración emergente/dinámica (que puede no estar en el artefacto de exportación porque se crea en runtime). |

### 3.3 Reglas de negocio y gobierno

**RN-T06-01 — La documentación es un artefacto operativo, no solo informativo**
La documentación debe ser usable directamente en procedimientos de DR y runbooks. Cada sección por dominio debe indicar explícitamente qué se restaura, qué no, y qué pasos adicionales son necesarios para una restauración completa.

**RN-T06-02 — Cobertura dominio por dominio**
La documentación debe cubrir los seis dominios del artefacto de exportación: IAM (Keycloak), PostgreSQL, MongoDB, Kafka, funciones (OpenWhisk) y almacenamiento (S3-compatible). Para cada dominio, debe detallar la distinción configuración vs. datos.

**RN-T06-03 — Alineación con la cadena T01-T05**
La documentación debe ser coherente con lo que T01 exporta, T02 versiona, T03 aplica, T04 valida y T05 prueba. No debe prometer restauración de elementos que ninguna de esas tareas cubre, ni omitir elementos que sí se restauran.

**RN-T06-04 — Identificación de gaps accionables**
Para cada dominio donde los datos de usuario no tienen cobertura de restauración integrada en la plataforma, la documentación debe identificar el gap de forma accionable: qué tipo de datos no se restauran, qué volumen aproximado podría tener, y qué mecanismo complementario (nativo del subsistema o futuro de la plataforma) podría cubrirlo.

**RN-T06-05 — Lenguaje accesible para múltiples audiencias**
La documentación debe ser comprensible tanto por operadores técnicos (SRE) como por perfiles de gestión (superadmin, product). Las secciones técnicas por dominio deben complementarse con un resumen ejecutivo y una tabla resumen de alto nivel.

**RN-T06-06 — Mantenibilidad ante evolución del producto**
La estructura de la documentación debe facilitar su actualización cuando se añadan nuevos dominios al artefacto de exportación o cuando se implementen capacidades de backup de datos. Cada dominio es una sección independiente que se puede actualizar sin afectar las demás.

---

## 4. Requisitos funcionales verificables

### RF-T06-001: Tabla resumen de alto nivel

La documentación debe incluir una tabla resumen que, para cada dominio del artefacto de exportación, indique en una vista rápida:

- Nombre del dominio.
- Qué elementos de configuración se restauran con el reaprovisionamiento (T03).
- Qué elementos de datos de usuario NO se restauran.
- Si existe un mecanismo complementario de backup de datos (nativo del subsistema o integrado).
- Estado del gap: cubierto, parcialmente cubierto, o no cubierto.

### RF-T06-002: Detalle por dominio — IAM (Keycloak)

La documentación debe describir para el dominio IAM:

- **Configuración restaurable**: roles, grupos, client scopes, identity providers, mappers (según lo que exporta T01 y aplica T03).
- **Datos no restaurables**: sesiones de usuario activas, tokens emitidos, historial de login, credenciales de usuarios individuales.
- **Mecanismo complementario**: exportación/importación nativa de Keycloak para datos de usuario del realm; limitaciones de ese mecanismo.

### RF-T06-003: Detalle por dominio — PostgreSQL

La documentación debe describir para el dominio PostgreSQL:

- **Configuración restaurable**: esquemas, tablas (estructura, columnas, tipos, constraints, índices), vistas, extensiones, grants (según T01/T03).
- **Datos no restaurables**: filas de tablas, secuencias (valores actuales), datos de vistas materializadas.
- **Mecanismo complementario**: pg_dump/pg_restore para backup de datos; snapshots de volumen; limitaciones (requiere acceso al subsistema, no integrado en la plataforma).

### RF-T06-004: Detalle por dominio — MongoDB

La documentación debe describir para el dominio MongoDB:

- **Configuración restaurable**: bases de datos, colecciones (validadores/schemas), índices, configuración de sharding (según T01/T03).
- **Datos no restaurables**: documentos almacenados en las colecciones.
- **Mecanismo complementario**: mongodump/mongorestore para backup de datos; snapshots; nota de que el dominio es opcional (`CONFIG_EXPORT_MONGO_ENABLED`).

### RF-T06-005: Detalle por dominio — Kafka

La documentación debe describir para el dominio Kafka:

- **Configuración restaurable**: topics (nombre, particiones, replicación, retention config), ACLs, consumer groups registrados (según T01/T03).
- **Datos no restaurables**: mensajes almacenados en los topics, offsets de consumidores, estado interno de consumer groups.
- **Mecanismo complementario**: MirrorMaker o herramientas de replicación de topics para datos; nota sobre la naturaleza efímera de los mensajes (sujetos a retention).

### RF-T06-006: Detalle por dominio — Funciones (OpenWhisk)

La documentación debe describir para el dominio funciones:

- **Configuración restaurable**: acciones (runtime, código fuente o referencia, límites), paquetes, triggers, rules (según T01/T03).
- **Datos no restaurables**: logs de ejecución de funciones, estado de activaciones, resultados de invocaciones previas.
- **Limitación transversal**: secretos y variables de entorno con valores redactados (`***REDACTED***`) requieren configuración manual post-restauración.
- **Mecanismo complementario**: no aplica para logs de ejecución (efímeros por diseño); nota de que el dominio es opcional (`CONFIG_EXPORT_OW_ENABLED`).

### RF-T06-007: Detalle por dominio — Almacenamiento (S3-compatible)

La documentación debe describir para el dominio almacenamiento:

- **Configuración restaurable**: buckets (versionado, lifecycle rules), políticas de acceso, configuración CORS (según T01/T03).
- **Datos no restaurables**: objetos almacenados en los buckets, versiones de objetos, metadatos de objetos individuales.
- **Mecanismo complementario**: replicación cross-region del proveedor S3-compatible, herramientas de sync (rclone, aws s3 sync); limitaciones (requiere acceso directo al subsistema).

### RF-T06-008: Sección de limitaciones transversales

La documentación debe incluir una sección que describa limitaciones que afectan a todos los dominios:

- Secretos redactados no se restauran; requieren configuración manual.
- Configuración dinámica/emergente puede no estar en el artefacto de exportación.
- La restauración de configuración no garantiza coherencia con los datos existentes (ej: una tabla restaurada sin sus filas).
- El reaprovisionamiento no es transaccional cross-domain; un fallo parcial puede dejar configuración restaurada en algunos dominios y no en otros.
- Los dominios opcionales pueden no estar disponibles según el perfil de despliegue.

### RF-T06-009: Sección de recomendaciones operativas

La documentación debe incluir recomendaciones operativas para una restauración completa (configuración + datos):

- Orden recomendado: restaurar primero la configuración (T03) y luego los datos de cada subsistema.
- Verificación post-restauración: cómo verificar que la configuración restaurada es coherente con los datos restaurados.
- Periodicidad recomendada de exportaciones de configuración y backups de datos.
- Integración con pruebas de restauración (T05) como validación periódica del procedimiento completo.

### RF-T06-010: Resumen ejecutivo

La documentación debe incluir un resumen ejecutivo de no más de una página que permita a un superadmin o product manager entender en menos de 5 minutos:

- Qué restaura el reaprovisionamiento de configuración.
- Qué NO restaura.
- Qué mecanismos complementarios existen.
- Cuáles son los gaps principales.

### RF-T06-011: Publicación accesible en la documentación del producto

La documentación producida debe estar disponible como artefacto consultable por los actores autorizados. El formato debe ser legible sin herramientas especiales (Markdown o equivalente) y debe poder integrarse en la base de conocimiento operativa de la plataforma.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Permisos de acceso a la documentación

| Actor | Acceso a la documentación |
|---|---|
| SRE / Platform team | ✅ Acceso completo (incluye detalles técnicos por dominio) |
| Superadmin | ✅ Acceso completo |
| Tenant owner | ✅ Acceso al resumen ejecutivo y tabla resumen; acceso limitado a detalles técnicos por dominio según política de comunicación |
| QA / Auditoría | ✅ Acceso completo |
| Equipo de producto | ✅ Acceso completo |

### 5.2 Seguridad

- La documentación no debe contener credenciales, secretos, URLs internas de subsistemas ni información sensible del entorno.
- La documentación puede referenciar nombres de variables de entorno (ej: `CONFIG_EXPORT_MONGO_ENABLED`) como parámetros de configuración sin revelar sus valores.
- Los ejemplos incluidos en la documentación deben usar datos ficticios o genéricos.

### 5.3 Trazabilidad con el backlog

| Requisito funcional | RF del backlog |
|---|---|
| Documentación de diferencias config vs. datos por dominio | RF-BKP-003 |
| Identificación de gaps y mecanismos complementarios | RF-BKP-004 |

---

## User Scenarios & Testing

### User Story 1 — SRE planifica un procedimiento de DR completo (Priority: P1)

Un SRE necesita restaurar un tenant completo tras un incidente crítico. Consulta la documentación de diferencias para planificar un procedimiento que combine reaprovisionamiento de configuración (T03) con restauración de datos desde backups de cada subsistema.

**Why this priority**: Es el caso de uso fundamental que justifica esta documentación. Sin ella, el SRE puede asumir que el reaprovisionamiento cubre datos, dejando el tenant parcialmente restaurado.

**Independent Test**: Dado la documentación publicada, un SRE puede identificar en menos de 10 minutos, para cada dominio, qué necesita restaurar con T03 (configuración) y qué necesita restaurar por otros medios (datos).

**Acceptance Scenarios**:

1. **Given** la documentación de diferencias publicada, **When** un SRE consulta la tabla resumen, **Then** puede identificar para cada uno de los seis dominios si los datos de usuario están cubiertos, parcialmente cubiertos o no cubiertos por la cadena de restauración de configuración.
2. **Given** la documentación de diferencias publicada, **When** un SRE consulta el detalle del dominio PostgreSQL, **Then** encuentra explícitamente listados los elementos de configuración que se restauran (esquemas, tablas, índices) y los datos que no se restauran (filas, secuencias), junto con el mecanismo complementario recomendado (pg_dump/pg_restore).

---

### User Story 2 — Superadmin comunica alcance de recuperación a stakeholders (Priority: P1)

Un superadmin necesita explicar a un tenant owner qué puede y qué no puede recuperarse de su tenant tras un incidente. Utiliza el resumen ejecutivo de la documentación como base para la comunicación.

**Why this priority**: Alinear expectativas es crítico para la confianza en la plataforma. Una comunicación incorrecta genera riesgo reputacional y pérdida de confianza.

**Independent Test**: Dado el resumen ejecutivo, un superadmin sin conocimiento técnico profundo puede explicar en lenguaje no técnico la distinción entre restauración de configuración y restauración de datos.

**Acceptance Scenarios**:

1. **Given** el resumen ejecutivo de la documentación, **When** un superadmin lo lee, **Then** puede resumir en dos párrafos qué se restaura automáticamente (configuración) y qué requiere pasos adicionales (datos).
2. **Given** el resumen ejecutivo, **When** un superadmin lo comparte con un tenant owner, **Then** el tenant owner entiende que sus datos (filas, documentos, objetos) no se restauran con el reaprovisionamiento de configuración.

---

### User Story 3 — Equipo de producto identifica gaps de cobertura (Priority: P2)

El product manager revisa la documentación para alimentar la priorización de futuras historias de backup de datos por subsistema.

**Why this priority**: Permite decisiones informadas de inversión en capacidades de backup de datos, pero no bloquea operaciones actuales.

**Independent Test**: Dado la documentación, el product manager puede extraer una lista de gaps accionables con suficiente contexto para crear historias de usuario.

**Acceptance Scenarios**:

1. **Given** la documentación de diferencias, **When** el product manager revisa la columna de estado del gap en la tabla resumen, **Then** puede identificar qué dominios tienen datos de usuario sin cobertura de restauración integrada.
2. **Given** el detalle de un dominio con gap "no cubierto", **When** se revisa la sección de mecanismo complementario, **Then** se describe qué tipo de mecanismo se necesitaría y qué datos cubriría.

---

### User Story 4 — Auditor verifica coherencia documentación-capacidades (Priority: P2)

Un auditor de continuidad operativa verifica que la documentación es coherente con las capacidades reales de la plataforma (T01-T05).

**Why this priority**: Necesario para cumplimiento normativo y auditoría, pero no bloquea la operación diaria.

**Independent Test**: Dado la documentación y las especificaciones de T01-T05, un auditor puede verificar que no hay elementos prometidos en la documentación que no estén cubiertos por las capacidades existentes.

**Acceptance Scenarios**:

1. **Given** la documentación de diferencias y la especificación de T01, **When** un auditor compara los dominios listados como "configuración restaurable", **Then** cada elemento coincide con lo que los recolectores de T01 exportan y los aplicadores de T03 aplican.
2. **Given** la documentación de diferencias y las pruebas de T05, **When** un auditor revisa la cobertura de pruebas, **Then** las pruebas validan la restauración de los mismos elementos que la documentación declara como restaurables.

---

### User Story 5 — Nuevo SRE se incorpora y entiende el modelo de restauración (Priority: P3)

Un SRE recién incorporado necesita entender rápidamente el alcance de la restauración disponible en la plataforma.

**Why this priority**: Facilita onboarding, pero no bloquea operaciones actuales si hay equipo experimentado disponible.

**Independent Test**: Dado la documentación, un nuevo SRE puede describir el modelo de restauración (configuración vs. datos) en menos de 30 minutos de lectura.

**Acceptance Scenarios**:

1. **Given** la documentación completa, **When** un nuevo SRE la lee de principio a fin, **Then** puede explicar la diferencia entre restauración de configuración y restauración de datos, enumerar los seis dominios, y describir para al menos tres dominios qué se restaura y qué no.

---

### Edge Cases

- ¿Qué ocurre si un dominio opcional no está habilitado en el despliegue? → La documentación debe indicar que los dominios opcionales (MongoDB, OpenWhisk) pueden no estar disponibles, y que en esos casos no hay ni configuración ni datos que restaurar para ese dominio.
- ¿Qué ocurre si un subsistema no tiene mecanismo nativo de backup de datos? → La documentación debe identificar el gap explícitamente y recomendar la implementación de uno como trabajo futuro.
- ¿Cómo se maneja la divergencia entre la documentación y las capacidades reales tras un upgrade del producto? → La documentación debe actualizarse como parte del proceso de cambio cuando se añaden o eliminan dominios del artefacto de exportación (RN-T06-06).

---

## Requirements

### Functional Requirements

- **FR-001**: La documentación DEBE incluir una tabla resumen de alto nivel con los seis dominios, indicando para cada uno qué configuración se restaura, qué datos no se restauran, y el estado del gap (RF-T06-001).
- **FR-002**: La documentación DEBE incluir una sección de detalle por cada uno de los seis dominios (IAM, PostgreSQL, MongoDB, Kafka, funciones, almacenamiento) con la distinción explícita entre configuración restaurable y datos no restaurables (RF-T06-002 a RF-T06-007).
- **FR-003**: La documentación DEBE incluir una sección de limitaciones transversales que aplican a todos los dominios (RF-T06-008).
- **FR-004**: La documentación DEBE incluir recomendaciones operativas para restauración completa (configuración + datos) con orden recomendado y verificación post-restauración (RF-T06-009).
- **FR-005**: La documentación DEBE incluir un resumen ejecutivo comprensible por perfiles no técnicos en menos de 5 minutos (RF-T06-010).
- **FR-006**: La documentación DEBE estar publicada en formato legible sin herramientas especiales (Markdown o equivalente) e integrable en la base de conocimiento operativa (RF-T06-011).
- **FR-007**: La documentación NO DEBE contener credenciales, secretos, URLs internas ni información sensible del entorno.
- **FR-008**: La documentación DEBE ser coherente con las capacidades documentadas en T01-T05; no debe prometer restauración de elementos no cubiertos ni omitir elementos cubiertos.
- **FR-009**: Para cada dominio con datos de usuario sin cobertura de restauración integrada, la documentación DEBE identificar el gap de forma accionable: tipo de datos, mecanismo complementario existente o necesario (RF-T06-004).
- **FR-010**: La documentación DEBE mencionar explícitamente la limitación de secretos redactados (`***REDACTED***`) y la necesidad de configuración manual post-restauración.

### Key Entities

- **Documento de diferencias config vs. datos**: Artefacto Markdown estructurado por dominios que constituye la referencia operativa principal producida por esta tarea.
- **Tabla resumen**: Vista consolidada de alto nivel con el estado de restauración por dominio.
- **Detalle por dominio**: Sección por cada subsistema que desglosa configuración restaurable, datos no restaurables, y mecanismo complementario.
- **Resumen ejecutivo**: Sección de alto nivel para audiencias no técnicas.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Un SRE puede identificar, para cada dominio, qué elementos se restauran con el reaprovisionamiento y cuáles requieren mecanismos adicionales, en menos de 10 minutos de consulta.
- **SC-002**: Un superadmin puede explicar la distinción entre restauración de configuración y restauración de datos a un tenant owner basándose exclusivamente en el resumen ejecutivo, sin necesidad de consultar las especificaciones de T01-T05.
- **SC-003**: La tabla resumen cubre los seis dominios del artefacto de exportación sin omisiones ni elementos que no correspondan a la cadena T01-T05.
- **SC-004**: Cada dominio detallado incluye al menos: elementos de configuración restaurables, elementos de datos no restaurables, y mecanismo complementario (existente o identificado como gap).
- **SC-005**: La documentación no contiene afirmaciones que contradigan las especificaciones de T01, T02, T03, T04 o T05.
- **SC-006**: Un auditor puede verificar la coherencia entre la documentación y las capacidades reales de la plataforma en menos de 30 minutos comparando esta documentación con las especificaciones de T01-T05.

---

## 6. Criterios de aceptación

**CA-01 — Tabla resumen completa**
Dado el documento de diferencias, cuando se revisa la tabla resumen, entonces contiene una entrada por cada uno de los seis dominios (IAM, PostgreSQL, MongoDB, Kafka, funciones, almacenamiento) con columnas para: configuración restaurable, datos no restaurables, mecanismo complementario y estado del gap.

**CA-02 — Detalle por dominio IAM**
Dado el documento de diferencias, cuando se revisa la sección de IAM, entonces lista explícitamente los elementos de configuración restaurables (roles, grupos, client scopes, identity providers, mappers), los datos no restaurables (sesiones, tokens, historial de login, credenciales de usuario), y el mecanismo complementario disponible.

**CA-03 — Detalle por dominio PostgreSQL**
Dado el documento de diferencias, cuando se revisa la sección de PostgreSQL, entonces distingue claramente entre estructura restaurable (esquemas, tablas, índices, vistas, extensiones, grants) y datos no restaurables (filas, valores de secuencias, datos de vistas materializadas), e identifica pg_dump/pg_restore como mecanismo complementario.

**CA-04 — Detalle por dominio MongoDB**
Dado el documento de diferencias, cuando se revisa la sección de MongoDB, entonces distingue entre configuración restaurable (colecciones, validadores, índices, sharding) y datos no restaurables (documentos), nota la opcionalidad del dominio, e identifica mongodump/mongorestore como mecanismo complementario.

**CA-05 — Detalle por dominio Kafka**
Dado el documento de diferencias, cuando se revisa la sección de Kafka, entonces distingue entre configuración restaurable (topics, ACLs, consumer groups) y datos no restaurables (mensajes, offsets), nota la naturaleza efímera de los mensajes, e identifica herramientas de replicación como mecanismo complementario.

**CA-06 — Detalle por dominio funciones**
Dado el documento de diferencias, cuando se revisa la sección de funciones OpenWhisk, entonces distingue entre configuración restaurable (acciones, paquetes, triggers, rules) y datos no restaurables (logs de ejecución, estado de activaciones), nota la opcionalidad del dominio y la limitación de secretos redactados.

**CA-07 — Detalle por dominio almacenamiento**
Dado el documento de diferencias, cuando se revisa la sección de almacenamiento S3, entonces distingue entre configuración restaurable (buckets, políticas, lifecycle, CORS) y datos no restaurables (objetos, versiones de objetos, metadatos de objetos), e identifica herramientas de sync/replicación como mecanismo complementario.

**CA-08 — Limitaciones transversales documentadas**
Dado el documento de diferencias, cuando se revisa la sección de limitaciones transversales, entonces menciona al menos: secretos redactados, configuración dinámica, incoherencia posible config-datos, no transaccionalidad cross-domain, y dominios opcionales.

**CA-09 — Recomendaciones operativas presentes**
Dado el documento de diferencias, cuando se revisa la sección de recomendaciones, entonces incluye al menos: orden recomendado de restauración (config antes que datos), verificación post-restauración, y referencia a las pruebas de T05.

**CA-10 — Resumen ejecutivo comprensible**
Dado el resumen ejecutivo del documento, cuando lo lee un superadmin sin conocimiento técnico profundo, entonces puede entender en menos de 5 minutos qué restaura el reaprovisionamiento, qué no restaura, y qué mecanismos complementarios existen.

**CA-11 — Coherencia con T01-T05**
Dado el documento de diferencias y las especificaciones de T01 a T05, cuando un auditor compara los elementos listados como "configuración restaurable" en cada dominio, entonces cada elemento coincide con lo que T01 exporta y T03 aplica. No hay elementos prometidos en la documentación que no estén cubiertos por T01-T05.

**CA-12 — Sin información sensible**
Dado el documento de diferencias, cuando se revisa su contenido completo, entonces no contiene credenciales, tokens, secretos, URLs internas de subsistemas ni datos reales de tenants.

**CA-13 — Formato publicable**
Dado el documento de diferencias, cuando se accede al artefacto, entonces está en formato Markdown legible sin herramientas especiales y puede integrarse en la base de conocimiento operativa de la plataforma.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Supuestos

| ID | Supuesto |
|---|---|
| **S-01** | Las especificaciones de T01 a T05 describen de forma completa y precisa qué elementos de configuración se exportan, validan, aplican y prueban. La documentación de T06 se basa en esas especificaciones como fuente de verdad. |
| **S-02** | Los mecanismos nativos de backup de datos de cada subsistema (pg_dump, mongodump, MirrorMaker, replicación S3) están disponibles en los entornos de despliegue, aunque no estén integrados en la plataforma. |
| **S-03** | La plataforma no tiene actualmente capacidades integradas de backup de datos de usuario. T06 documenta esta situación como gap sin resolver. |
| **S-04** | Los seis dominios del artefacto de exportación (IAM, PostgreSQL, MongoDB, Kafka, funciones, almacenamiento) son la lista completa de dominios relevantes para la restauración. Si se añaden nuevos dominios, la documentación se actualizará. |

### 7.2 Riesgos

| ID | Riesgo | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| **R-01** | La documentación puede quedar desactualizada si se añaden nuevos dominios o se modifican las capacidades de T01-T05 sin actualizar T06 | Media | Alto | Incluir un aviso en la documentación de T01-T05 que indique la necesidad de actualizar T06 ante cambios de alcance. Vincular la documentación al ciclo de release. |
| **R-02** | Los mecanismos complementarios de backup de datos descritos pueden no estar configurados en todos los entornos, generando falsa sensación de cobertura | Media | Medio | La documentación debe distinguir entre "mecanismo disponible" y "mecanismo configurado y operativo" en el entorno específico. |
| **R-03** | La documentación puede ser demasiado técnica para tenant owners o demasiado superficial para SREs | Media | Bajo | Estructurar la documentación con niveles: resumen ejecutivo (no técnico) y detalle por dominio (técnico). Cada audiencia lee la sección que corresponde. |

### 7.3 Preguntas abiertas

Ninguna pregunta abierta bloquea la especificación de esta tarea. Las decisiones sobre la implementación de capacidades de backup de datos (gaps identificados) son parte de futuras historias del roadmap, no de esta tarea.

---

## Assumptions

- La cadena T01-T05 está especificada y sus capacidades son conocidas y estables.
- La documentación se produce como un artefacto Markdown dentro del repositorio del proyecto, consultable por los actores autorizados.
- No se requiere implementación de código para esta tarea; el entregable es un documento operativo estructurado.
- La estructura por dominios facilita la actualización incremental conforme evoluciona la plataforma.

---

*Documento generado para el stage `speckit.specify` — US-BKP-02-T06 | Rama: `120-config-vs-data-restore-differences`*
