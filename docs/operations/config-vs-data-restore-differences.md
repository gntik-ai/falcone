# Diferencias entre restauración de configuración y restauración de datos

| | |
|---|---|
| **Feature branch** | `120-config-vs-data-restore-differences` |
| **Specs relacionados** | US-BKP-02-T01 (export), T02 (formato versionado), T03 (reaprovisionamiento), T04 (validación previa), T05 (tests funcionales) |
| **Última actualización** | 2026-04-01 |
| **Audiencia** | SRE / Platform team · Superadmin · Equipo de producto · QA / Auditoría |

---

## 1. Resumen ejecutivo

La plataforma incluye una cadena de reaprovisionamiento de configuración funcional (US-BKP-02, tareas T01 a T05) que permite exportar, validar e importar la **configuración estructural** de un tenant: esquemas de base de datos, topics de Kafka, roles de IAM, definiciones de funciones, políticas de buckets S3 y metadatos de MongoDB. Este mecanismo permite reconstruir la estructura operativa de un tenant en un entorno nuevo o restaurado.

**Lo que NO restaura esta cadena es el contenido de usuario**: filas de tablas PostgreSQL, documentos MongoDB, mensajes almacenados en Kafka, objetos de almacenamiento S3, credenciales de usuarios Keycloak ni logs de ejecución de funciones. Estos datos quedan fuera del alcance del artefacto de exportación y, por tanto, del reaprovisionamiento.

Para cubrir los datos de usuario existen **mecanismos complementarios nativos** de cada subsistema (`pg_dump`, `mongodump`, MirrorMaker 2, `rclone sync`, Keycloak realm export), pero ninguno está integrado en la plataforma como servicio automatizado. El backup y la restauración de datos de usuario son responsabilidad operativa del equipo SRE o del proveedor de infraestructura.

**Gaps principales**:

- Los datos de aplicación en PostgreSQL, MongoDB y S3 no tienen cobertura de backup integrada en la plataforma.
- Los mensajes de Kafka son efímeros por diseño y no recuperables una vez expirado `retention.ms`.
- Los secretos redactados (`***REDACTED***`) en el artefacto de exportación requieren configuración manual tras cada restauración.

Este documento detalla, dominio por dominio, qué restaura la cadena de configuración, qué no restaura y qué herramientas complementarias existen para cada caso.

---

## 2. Tabla resumen de alto nivel

| Dominio | Configuración restaurable (resumen) | Datos de usuario NO restaurables | Mecanismo complementario | Estado del gap |
|---|---|---|---|---|
| **IAM (Keycloak)** | Roles, grupos, client scopes, identity providers, protocol mappers, clients, config de realm | Sesiones, tokens, historial de login, credenciales de usuario, cuentas de usuario | Keycloak Admin REST API (realm export) | `no_cubierto` |
| **PostgreSQL** | Esquemas, tablas (DDL), índices, vistas, extensiones, grants | Filas de tablas, valores de secuencias, datos de vistas materializadas | `pg_dump` / `pg_restore` | `no_cubierto` |
| **MongoDB** ¹ | Bases de datos, colecciones, validadores JSON Schema, índices, sharding | Documentos en colecciones, GridFS objects | `mongodump` / `mongorestore` | `no_cubierto` |
| **Kafka** | Topics (config, particiones, replicación), ACLs, consumer groups (nombre) | Mensajes en topics, offsets, estado de consumer groups, transacciones | MirrorMaker 2 / `kafka-console-consumer` | `no_cubierto` |
| **Funciones (OpenWhisk)** ¹ | Acciones, paquetes, triggers, rules | Logs de activaciones, resultados de invocaciones, estado de activaciones activas | Repositorio Git del tenant | `no_cubierto` |
| **Almacenamiento (S3)** | Buckets (nombre, versionado), lifecycle rules, CORS, bucket policies | Objetos, versiones anteriores, metadatos individuales | `rclone sync` / `aws s3 sync` / replicación del proveedor | `no_cubierto` |

¹ Dominio opcional. MongoDB requiere `CONFIG_EXPORT_MONGO_ENABLED=true`; OpenWhisk requiere `CONFIG_EXPORT_OW_ENABLED=true`. Ambos devuelven `not_available` cuando están deshabilitados.

---

## 3. Detalle por dominio

### 3.1 IAM (Keycloak)

#### Configuración restaurable

- Roles de realm.
- Grupos (estructura jerárquica y membresías de grupo, sin usuarios individuales).
- Client scopes.
- Identity providers (sin credenciales — redactadas como `***REDACTED***`).
- Protocol mappers.
- Clients (metadatos de configuración, sin client secrets).
- Configuración de realm (token lifetime, session settings, etc.).

#### Datos de usuario NO restaurables

- Sesiones de usuario activas.
- Tokens emitidos (access tokens, refresh tokens, ID tokens).
- Historial de login y eventos de auditoría internos de Keycloak.
- Credenciales de usuarios individuales (passwords, TOTP secrets).
- Cuentas de usuario registradas.

#### Mecanismo complementario

**Keycloak Admin REST API** — exportación/importación de realm completo.

Limitaciones:

- La exportación incluye credenciales hasheadas de usuarios, lo que conlleva consideraciones de privacidad.
- No está aislada por tenant; exporta el realm completo.
- No está integrada en la plataforma como servicio automatizado.

---

### 3.2 PostgreSQL

#### Configuración restaurable

- Esquemas.
- Tablas (DDL completo: columnas, tipos, constraints, PKs, FKs).
- Índices.
- Vistas (DDL).
- Vistas materializadas (DDL, sin datos).
- Extensiones instaladas.
- Grants sobre esquemas y tablas.

#### Datos de usuario NO restaurables

- Filas de tablas de aplicación.
- Valores actuales de secuencias (`currval`).
- Datos materializados en vistas materializadas.

#### Mecanismo complementario

**`pg_dump` / `pg_restore`** — backup lógico completo o por base de datos, esquema o tabla. Alternativa: snapshots de volumen persistente (PVC en Kubernetes).

Limitaciones:

- Requiere acceso directo al servidor PostgreSQL (credenciales DBA o acceso al PVC).
- No automatizado por tenant en la plataforma.

---

### 3.3 MongoDB

> **Dominio opcional**: requiere `CONFIG_EXPORT_MONGO_ENABLED=true`. Cuando está deshabilitado, el recolector devuelve `not_available` y no hay exportación ni restauración posible para este dominio.

#### Configuración restaurable

- Bases de datos (nombres).
- Colecciones (nombres, validadores JSON Schema).
- Índices (definición).
- Configuración de sharding (si aplica).

#### Datos de usuario NO restaurables

- Documentos almacenados en colecciones.
- GridFS objects.

#### Mecanismo complementario

**`mongodump` / `mongorestore`** — backup lógico por base de datos o colección.

Limitaciones:

- Requiere acceso directo al subsistema MongoDB.
- Dominio opcional; puede no estar disponible en todos los perfiles de despliegue.

---

### 3.4 Kafka

#### Configuración restaurable

- Topics (nombre, número de particiones, factor de replicación, configuración de retention).
- ACLs de topics.
- Consumer groups registrados (nombre — sin estado ni offsets).

#### Datos de usuario NO restaurables

- Mensajes almacenados en los topics (sujetos a `retention.ms`).
- Offsets de consumidores.
- Estado interno de consumer groups (lag, posición de consumo).
- Datos de transacciones Kafka.

> **Nota crítica**: los mensajes de Kafka son efímeros por diseño. Una vez expirada la ventana de retención (`retention.ms`), los mensajes no son recuperables aunque exista infraestructura de backup.

#### Mecanismo complementario

**MirrorMaker 2** (replicación de topics entre clusters) o **`kafka-console-consumer`** con persistencia a archivo.

Limitaciones:

- La ventana de oportunidad para backup está limitada por la retención configurada.
- No existe mecanismo de snapshot o replicación de mensajes por tenant en la plataforma.

---

### 3.5 Funciones (OpenWhisk)

> **Dominio opcional**: requiere `CONFIG_EXPORT_OW_ENABLED=true`. Cuando está deshabilitado, el recolector devuelve `not_available`.

#### Configuración restaurable

- Acciones (runtime, código fuente o referencia, límites de memoria/timeout).
- Paquetes.
- Triggers (tipo, configuración — sin valores de parámetros sensibles, que son redactados como `***REDACTED***`).
- Rules (bindings trigger → action).

> **Nota sobre secretos**: los parámetros de acciones cuyos nombres coinciden con patrones sensibles (password, secret, token, key, credential) se redactan como `***REDACTED***` en el artefacto de exportación. Tras la restauración, estos parámetros deben configurarse manualmente.

#### Datos de usuario NO restaurables

- Logs de ejecución de activaciones.
- Resultados almacenados de invocaciones previas.
- Estado de activaciones activas.

#### Mecanismo complementario

**Repositorio Git del tenant** — el código fuente de las acciones debería estar versionado en el repositorio del tenant, no depender exclusivamente de la plataforma.

Limitaciones:

- Los logs de activación son efímeros por diseño en OpenWhisk; no existe mecanismo estándar de backup.
- La responsabilidad del código fuente recae en el repositorio Git del tenant.

---

### 3.6 Almacenamiento (S3-compatible)

#### Configuración restaurable

- Buckets (nombre, versionado habilitado).
- Lifecycle rules.
- Configuración CORS.
- Políticas de acceso (bucket policies).

#### Datos de usuario NO restaurables

- Objetos almacenados en los buckets.
- Versiones anteriores de objetos (si el versionado está habilitado).
- Metadatos de objetos individuales.

#### Mecanismo complementario

**`rclone sync`**, **`aws s3 sync`** o replicación cross-bucket/cross-region del proveedor S3-compatible.

Limitaciones:

- Requiere acceso directo a las credenciales del bucket.
- No integrado en la plataforma como servicio automatizado.

---

## 4. Limitaciones transversales

### TL-01 — Secretos redactados

Todo valor de parámetro cuyo nombre coincida con patrones heurísticos de campo sensible (password, secret, token, key, credential) es sustituido por `***REDACTED***` en el artefacto de exportación. Esto afecta a credenciales de identity providers en Keycloak, parámetros de acciones OpenWhisk y variables sensibles de configuración.

**Consecuencia**: el reaprovisionamiento desde el artefacto no es completo sin una fase manual de configuración de secretos post-restauración.

### TL-02 — Configuración dinámica/emergente

No toda la configuración existente en un tenant fue creada declarativamente a través de la plataforma. Ejemplos:

- Consumer groups en Kafka creados automáticamente por aplicaciones al consumir por primera vez.
- Usuarios de Keycloak creados por auto-registro o flows de invitación.
- Índices creados directamente por aplicaciones del tenant con conexión directa a PostgreSQL.

Esta configuración emergente puede no estar presente (o estar sólo parcialmente) en el artefacto de exportación.

### TL-03 — Incoherencia posible entre configuración restaurada y datos existentes

Si el tenant destino ya contiene datos, restaurar la configuración sobre esos datos puede generar incoherencias:

- Esquemas PostgreSQL con constraints que los datos existentes no cumplen.
- Topics Kafka con configuraciones de retención diferentes a las esperadas por los consumidores.
- Buckets S3 con lifecycle rules modificadas que afectan objetos ya existentes.

La validación previa de T04 mitiga parcialmente este riesgo, pero no lo elimina completamente.

### TL-04 — No-transaccionalidad cross-domain

T03 aplica dominios de forma secuencial e independiente. No existe un mecanismo de rollback atómico cross-domain. Si un dominio se aplica correctamente pero el siguiente falla, el tenant queda con configuración parcialmente restaurada.

### TL-05 — Dominios opcionales según perfil de despliegue

MongoDB (`CONFIG_EXPORT_MONGO_ENABLED`) y OpenWhisk (`CONFIG_EXPORT_OW_ENABLED`) son opcionales, ambos deshabilitados por defecto. En entornos donde estos dominios están deshabilitados, no hay exportación ni restauración posible de configuración ni datos para esos dominios.

---

## 5. Recomendaciones operativas

### 5.1 Orden recomendado de restauración completa

Para una restauración integral (configuración + datos), se recomienda el siguiente orden:

1. Ejecutar la validación previa de T04 (pre-flight conflict check) sobre el tenant destino.
2. Ejecutar el reaprovisionamiento T03 (restauración de configuración).
3. Configurar manualmente los secretos redactados en cada dominio afectado.
4. Restaurar los datos de usuario por subsistema usando los mecanismos complementarios (`pg_restore`, `mongorestore`, MirrorMaker, `rclone`, Keycloak realm import) — en paralelo o secuencialmente según necesidad.
5. Verificar la coherencia entre la configuración restaurada y los datos importados (constraints, índices, lifecycle rules).
6. Ejecutar la suite de tests funcionales T05 para validar la configuración restaurada.

### 5.2 Verificación post-restauración

- Confirmar que los esquemas PostgreSQL restaurados aceptan las filas importadas sin violaciones de constraints.
- Verificar que los consumer groups de Kafka pueden reanudar el consumo desde los offsets restaurados.
- Validar que los roles y client scopes de Keycloak son accesibles para las sesiones activas del tenant.
- Comprobar que las lifecycle rules de S3 no eliminan prematuramente objetos recién restaurados.

### 5.3 Periodicidad recomendada

- **Exportación de configuración** (T01/T02): diaria o ante cada cambio significativo de configuración.
- **Backup de datos de usuario** por subsistema: según los requisitos de SLA y criticidad de los datos; típicamente entre diario y horario según el RPO (Recovery Point Objective) definido.

### 5.4 Integración con pruebas de T05

La suite funcional T05 (US-BKP-02-T05) valida la cadena de restauración de configuración. Se recomienda ejecutar T05 periódicamente (al menos tras cada exportación mayor) como health check del procedimiento de DR para configuración.

T05 **no valida** la restauración de datos de usuario; esa validación es responsabilidad de las pruebas específicas de backup de cada subsistema.

---

## 6. Trazabilidad y mantenibilidad

### 6.1 Fuentes de verdad

Este documento deriva los inventarios de "configuración restaurable" de las especificaciones de los recolectores de T01 y los aplicadores de T03. Si T01 o T03 cambian de alcance (nuevo dominio añadido, elemento eliminado), este documento debe actualizarse en el mismo change set.

Fuentes de referencia:

- Especificación US-BKP-02-T01 — recolectores por dominio.
- Especificación US-BKP-02-T03 — aplicadores de reaprovisionamiento.
- Código de recolectores en `services/provisioning-orchestrator/src/collectors/`.
- Especificación US-BKP-02-T04 — validaciones previas.
- Especificación US-BKP-02-T05 — tests funcionales de la cadena.

### 6.2 Procedimiento de actualización

Cuando se modifique el alcance de la cadena de exportación/reaprovisionamiento:

1. **Nuevo dominio añadido a T01**: agregar una fila a la tabla resumen (sección 2), una nueva subsección en la sección 3 con los tres sub-apartados, y revisar las secciones 4 y 5 por si el nuevo dominio introduce nuevas limitaciones u operativas.
2. **Dominio eliminado**: eliminar sus entradas de las secciones 2 y 3. Verificar que las secciones 4 y 5 no queden con referencias huérfanas.
3. **Cambio de elementos exportados/aplicados**: actualizar las listas de configuración restaurable y datos no restaurables del dominio afectado.
4. Toda actualización debe revisarse para mantener coherencia con la cobertura de T05.
