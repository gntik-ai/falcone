# Especificación — US-BKP-02-T02: Formato de export/import versionado y compatible con upgrades del producto

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-02-T02                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-02 — Exportación de configuración funcional y reprovisionamiento de tenants |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-003, RF-BKP-004                                               |
| **Dependencias**    | US-TEN-04, US-BKP-01, US-BKP-02-T01                                  |

---

## 1. Objetivo y problema que resuelve

### Problema

US-BKP-02-T01 introduce la capacidad de exportar la configuración funcional de un tenant como un artefacto JSON estructurado, con un campo `format_version` en la metadata. Sin embargo, la especificación de T01 reconoce explícitamente (supuesto S-05) que el formato inicial no necesita ser compatible con versiones futuras del producto desde el primer día, y delega la compatibilidad forward/backward a esta tarea.

Sin un esquema de versionado formal y reglas de compatibilidad:

1. **Los artefactos de exportación se vuelven frágiles ante upgrades del producto.** Cuando la plataforma evoluciona (nuevos dominios de configuración, campos adicionales en dominios existentes, cambios de estructura en los recolectores), los artefactos generados por versiones anteriores se vuelven ininterpretables o silenciosamente incompatibles.
2. **La importación (US-BKP-02-T03) no puede operar de forma segura** si no existe una política clara de qué versiones del formato puede aceptar y cómo adaptar artefactos de versiones anteriores al formato actual.
3. **No existe un contrato explícito entre el productor (exportación) y el consumidor (importación/herramientas externas)** sobre qué garantías ofrece cada versión del formato, qué cambios son compatibles y cuáles son breaking.

### Objetivo de esta tarea

Definir el esquema formal del artefacto de export/import, establecer una política de versionado semántico del formato, y proveer un mecanismo de validación y migración que permita al producto interpretar artefactos de versiones anteriores del formato de forma segura, incluso cuando el producto ha evolucionado.

El resultado es que el formato de exportación tenga un ciclo de vida gestionado: cada artefacto declara su versión, la plataforma sabe qué versiones puede interpretar, y existe una ruta definida para migrar artefactos antiguos al formato actual.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Opera migraciones y restauraciones que pueden involucrar artefactos generados por versiones anteriores del producto | Confianza de que un artefacto exportado hace meses sigue siendo utilizable tras un upgrade de la plataforma, con un proceso de migración explícito y trazable. |
| **Superadmin** | Gestiona exportaciones como parte de auditoría y gobernanza | Puede verificar la versión de un artefacto y saber si es compatible con la versión actual de la plataforma antes de intentar una importación. |
| **Proceso interno (automatización de backup)** | Genera artefactos periódicamente que se almacenan a largo plazo | Los artefactos almacenados siguen siendo válidos incluso cuando la plataforma se actualiza, porque existe un pipeline de migración de formato. |
| **Equipo de desarrollo / Platform team** | Evoluciona el producto y añade nuevos dominios o campos a la configuración | Tiene reglas claras sobre qué cambios en el formato son compatibles, cuáles requieren bump de versión minor y cuáles requieren bump major, reduciendo el riesgo de romper la cadena export/import. |
| **Tenant owner** | Consumidor indirecto | Garantía de que la configuración exportada de su tenant mantiene valor a lo largo del tiempo, no solo en el instante de la exportación. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Validación de un artefacto contra el esquema de su versión declarada**

> Un SRE recibe un artefacto de exportación y lo pasa por el endpoint de validación antes de intentar una importación. El sistema lee la `format_version` del artefacto, localiza el esquema correspondiente a esa versión, valida la estructura del artefacto contra el esquema, y devuelve un resultado indicando si el artefacto es válido, inválido (con errores detallados) o válido con advertencias (campos desconocidos ignorados).

**E2 — Importación de un artefacto generado con una versión anterior del formato**

> La plataforma está en la versión de formato `2.1.0`. Un SRE intenta importar un artefacto exportado cuando la plataforma usaba formato `1.3.0`. El sistema detecta la diferencia de versiones, ejecuta la cadena de migraciones (`1.3.0 → 1.4.0 → 2.0.0 → 2.1.0`), y presenta al operador el artefacto migrado para su validación antes de proceder con la importación efectiva (que es responsabilidad de US-BKP-02-T03).

**E3 — Exportación incluye la versión actual del formato**

> Cuando se ejecuta una exportación (US-BKP-02-T01), el artefacto resultante incluye en su metadata `format_version` con el valor de la versión actual del esquema registrado en la plataforma. Este valor se obtiene del registro de esquemas, no está hardcodeado.

**E4 — Consulta de versiones de formato soportadas**

> Un operador consulta un endpoint que devuelve la versión actual del formato de exportación, la versión mínima migrable, y la lista de versiones intermedias con sus cambios resumidos. Esto permite evaluar si un artefacto antiguo puede migrarse antes de intentar la operación.

**E5 — Evolución del formato por adición de un nuevo dominio de configuración**

> El producto añade un nuevo subsistema gestionado (p. ej., un servicio de caché). El equipo de desarrollo registra un nuevo dominio en el esquema del artefacto, incrementa la versión minor del formato (`2.1.0 → 2.2.0`), y escribe una migración que, para artefactos `≤ 2.1.0`, añade el nuevo dominio con `"status": "not_available"`. Los artefactos anteriores siguen siendo válidos e importables.

**E6 — Cambio breaking en la estructura de un dominio existente**

> El equipo de desarrollo necesita reestructurar la sección de IAM (p. ej., unificar `roles` y `groups` en una nueva estructura `identity_objects`). Esto requiere un bump de versión major (`2.x → 3.0.0`). Se escribe una migración que transforma la estructura antigua a la nueva. Los artefactos con versión major anterior pueden migrarse, pero la migración es explícita y requiere revisión del operador.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Artefacto sin campo `format_version` | Se rechaza con error claro: `"format_version is required"`. No se intenta inferir la versión. |
| Artefacto con `format_version` desconocida (futura) | Se rechaza con error claro: `"format_version 4.0.0 is not recognized by this platform version"`. No se intenta una migración inversa (downgrade de formato). |
| Artefacto con versión declarada válida pero estructura corrupta o truncada | La validación contra el esquema falla y reporta los errores estructurales. No se intenta migración de un artefacto inválido en su propia versión. |
| Artefacto con campos adicionales no definidos en el esquema de su versión | El validador emite advertencias pero no rechaza el artefacto. Los campos desconocidos se preservan sin interpretarlos (`additionalProperties: preserve`). |
| Migración de un artefacto muy antiguo (múltiples major versions atrás) | La cadena de migraciones se ejecuta secuencialmente versión a versión. Si una migración intermedia falla, la cadena se detiene y se reporta el punto de fallo. No se aplican migraciones parciales. |
| Dos versiones del producto producen artefactos con el mismo `format_version` | Válido si los cambios entre releases del producto no afectaron la estructura del artefacto. La versión de formato solo cambia cuando cambia el esquema, no con cada release del producto. |
| Artefacto migrado que pierde información por cambio de estructura | La migración documenta qué información no puede mapearse al nuevo formato y la incluye en una sección `_migration_warnings` del artefacto migrado. El operador puede revisar antes de importar. |

### 3.3 Reglas de negocio y gobierno

**RN-T02-01 — Versionado semántico del formato**
La versión del formato sigue Semantic Versioning (MAJOR.MINOR.PATCH):

- **PATCH**: correcciones de documentación del esquema, aclaraciones, sin cambio funcional.
- **MINOR**: adición de nuevos dominios, nuevos campos opcionales dentro de un dominio existente, nuevo valor de `status` para un dominio. Los artefactos de versiones minor anteriores siguen siendo válidos sin migración (backward compatible).
- **MAJOR**: cambios en la estructura de dominios existentes, eliminación de campos, renombrado de claves, cambio de semántica de campos existentes. Requiere migración explícita.

**RN-T02-02 — El esquema es el contrato, no la implementación**
El esquema del formato de exportación es un artefacto gestionado dentro del producto, versionado y publicado. Los recolectores (US-BKP-02-T01) deben producir artefactos conformes al esquema vigente. La importación (US-BKP-02-T03) debe validar contra el esquema antes de operar.

**RN-T02-03 — Compatibilidad backward obligatoria dentro del mismo major**
Dentro del mismo major version, la plataforma debe poder interpretar y validar artefactos de cualquier minor/patch anterior sin migración. Un artefacto `2.1.0` debe ser aceptable por una plataforma que usa formato `2.5.0`.

**RN-T02-04 — Migraciones entre major versions son explícitas**
No se aplican migraciones de formato automáticamente durante la importación. El operador debe solicitar explícitamente la migración, revisar el artefacto migrado, y luego proceder con la importación. Esto evita transformaciones silenciosas de datos de configuración.

**RN-T02-05 — Cada migración es una función pura y determinista**
Una migración recibe un artefacto en versión N y produce un artefacto en versión N+1. No consulta estado externo, no tiene efectos secundarios, no depende del tenant ni del entorno. Dado el mismo input, produce el mismo output.

**RN-T02-06 — El registro de esquemas es parte del producto**
El producto mantiene un registro interno de las versiones del esquema disponibles, sus definiciones, y las migraciones entre ellas. Este registro se consulta en tiempo de ejecución para validar y migrar artefactos.

**RN-T02-07 — La versión del formato es independiente de la versión del producto**
La versión del formato de exportación tiene su propio ciclo de vida. Un upgrade del producto no implica necesariamente un cambio de formato. Un cambio de formato se produce solo cuando el esquema del artefacto cambia.

**RN-T02-08 — No se soporta downgrade de formato**
No existe migración de una versión de formato superior a una inferior. Si un artefacto fue generado por una versión de la plataforma más reciente que la actual, se rechaza.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T02-01 — Esquema formal del artefacto de exportación**
Debe existir una definición formal del esquema del artefacto de exportación (JSON Schema o equivalente funcional) que describa: la estructura de la metadata raíz (`format_version`, `export_timestamp`, `tenant_id`, `deployment_profile`, `schema_checksum`), la estructura de cada sección de dominio (`status`, `items`, `collected_at`), y los tipos y restricciones de cada campo. Este esquema es la versión `1.0.0` del formato.

**RF-T02-02 — Validación de artefactos contra el esquema**
Debe existir un endpoint REST que, dado un artefacto de exportación, lea su `format_version`, localice el esquema correspondiente, valide la estructura del artefacto contra el esquema, y devuelva un resultado con estado (`valid`, `invalid`, `valid_with_warnings`), lista de errores si los hay, y lista de advertencias (campos desconocidos, deprecaciones).

**RF-T02-03 — Registro de versiones de esquema**
Debe existir un componente interno que mantenga el catálogo de versiones de esquema disponibles, con su definición, fecha de publicación, y notas de cambio respecto a la versión anterior. El registro es consultable en tiempo de ejecución.

**RF-T02-04 — Endpoint de versiones de formato soportadas**
Debe existir un endpoint REST que devuelva: la versión actual del formato, la versión mínima que puede migrarse a la actual, y la lista de versiones intermedias con un resumen de cambios por versión.

**RF-T02-05 — Mecanismo de migración entre versiones major**
Debe existir un mecanismo que, dado un artefacto con `format_version` de un major anterior al actual, ejecute la cadena secuencial de migraciones necesarias para transformar el artefacto al formato actual. El resultado es un artefacto migrado (no importado) que el operador puede inspeccionar.

**RF-T02-06 — Endpoint de migración de artefactos**
Debe existir un endpoint REST que reciba un artefacto de exportación, determine si requiere migración (versión de formato anterior al major actual), ejecute las migraciones necesarias, y devuelva el artefacto migrado con metadata adicional que indique la cadena de migraciones aplicada y cualquier advertencia (`_migration_metadata`).

**RF-T02-07 — Preservación de campos desconocidos**
El validador y el migrador deben preservar campos presentes en el artefacto que no estén definidos en el esquema de su versión. Estos campos se pasan sin modificar y se reportan como advertencias, no como errores.

**RF-T02-08 — Advertencias de migración por pérdida de información**
Cuando una migración transforma una estructura que no tiene mapeo exacto en el formato destino, la migración debe incluir una sección `_migration_warnings` en el artefacto migrado que describa qué información se perdió o se transformó de manera no reversible.

**RF-T02-09 — Checksum de integridad del esquema**
Cada artefacto exportado debe incluir un campo `schema_checksum` en la metadata raíz que contenga un hash del esquema utilizado para generar el artefacto. Esto permite detectar si un artefacto fue generado con un esquema no oficial o modificado.

**RF-T02-10 — Rechazo de artefactos sin versión o con versión futura**
El validador y el migrador deben rechazar con error claro artefactos que no contengan `format_version` o que declaren una versión posterior a la más reciente conocida por la plataforma.

**RF-T02-11 — Compatibilidad backward dentro del mismo major**
La plataforma debe aceptar y validar correctamente artefactos de cualquier minor/patch dentro del mismo major version sin requerir migración. Un artefacto `1.0.0` debe ser aceptado por una plataforma con formato `1.3.0`.

### 4.2 Límites claros de alcance

**Incluido en US-BKP-02-T02:**

- Esquema formal del artefacto de exportación (definición del contrato).
- Política de versionado semántico del formato.
- Endpoint de validación de artefactos contra el esquema.
- Endpoint de consulta de versiones soportadas.
- Mecanismo de migración entre major versions y endpoint de migración.
- Registro interno de versiones de esquema.
- Reglas de compatibilidad backward dentro del mismo major.
- Preservación de campos desconocidos.
- Advertencias de migración.
- Checksum de integridad del esquema.

**Excluido (tareas hermanas):**

- Producción del artefacto de exportación (recolectores) → **US-BKP-02-T01** (ya implementado).
- Flujo de importación/reprovisionamiento usando el artefacto → **US-BKP-02-T03**.
- Validaciones de conflicto previas a importación → **US-BKP-02-T04**.
- Pruebas de restauración funcional en sandbox → **US-BKP-02-T05**.
- Documentación de diferencias entre restauración de config y de datos → **US-BKP-02-T06**.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- La validación de artefactos no requiere acceso a datos del tenant; opera exclusivamente sobre el artefacto proporcionado como input.
- La migración de artefactos tampoco consulta estado del tenant ni del entorno; es una transformación pura sobre el documento.
- El endpoint de versiones soportadas es independiente del tenant.
- El registro de esquemas es global a la plataforma, no por tenant.

### 5.2 Permisos de acceso

| Actor | Validar artefacto | Consultar versiones soportadas | Migrar artefacto |
|---|---|---|---|
| Tenant owner | ❌ No | ❌ No | ❌ No |
| SRE / Platform team | ✅ Sí | ✅ Sí | ✅ Sí |
| Superadmin | ✅ Sí | ✅ Sí | ✅ Sí |
| Proceso interno (automatización) | ✅ Sí | ✅ Sí | ✅ Sí |

> **Nota**: Los mismos roles que tienen acceso a la exportación (US-BKP-02-T01) tienen acceso a la validación y migración. Son operaciones complementarias del mismo flujo operativo.

### 5.3 Auditoría

- Cada invocación de validación debe generar un evento de auditoría que registre: actor, `format_version` del artefacto validado, resultado (valid/invalid/valid_with_warnings), timestamp y correlation-id.
- Cada invocación de migración debe generar un evento de auditoría que registre: actor, versión de origen, versión destino, cadena de migraciones aplicada, presencia de warnings de migración, timestamp y correlation-id.
- Los eventos de auditoría se envían al pipeline estándar de la plataforma (US-OBS-01).

### 5.4 Seguridad

- Los endpoints de validación y migración requieren autenticación (token JWT de Keycloak) y autorización por rol.
- El artefacto enviado para validación o migración no se almacena en la plataforma; se procesa en memoria y se devuelve. No se persiste ningún artefacto como parte de estas operaciones.
- El esquema y las migraciones son código del producto, no configuración editable por operadores. Modificar esquemas o migraciones requiere un cambio en el código fuente y un nuevo release.
- Las respuestas de error no revelan detalles internos de la estructura de migraciones o del registro de esquemas más allá de lo necesario para el diagnóstico.

### 5.5 Trazabilidad con el backlog

| Requisito funcional | RF del backlog |
|---|---|
| Formato versionado y esquema formal del artefacto | RF-BKP-003 |
| Compatibilidad con upgrades y migración de artefactos | RF-BKP-004 |

---

## 6. Criterios de aceptación

**CA-01 — Esquema formal publicado**
Dado el registro de esquemas del producto, cuando se consulta la versión actual del formato, entonces existe una definición formal del esquema (JSON Schema o equivalente) que describe la estructura completa del artefacto de exportación incluyendo metadata raíz y todos los dominios conocidos.

**CA-02 — Validación exitosa de artefacto conforme**
Dado un artefacto de exportación generado por US-BKP-02-T01 con `format_version` igual a la versión actual del esquema, cuando se envía al endpoint de validación, entonces el resultado es `valid` sin errores.

**CA-03 — Validación fallida de artefacto con estructura incorrecta**
Dado un artefacto JSON con `format_version` válida pero con campos requeridos ausentes o tipos incorrectos, cuando se envía al endpoint de validación, entonces el resultado es `invalid` con una lista de errores que identifica los campos problemáticos.

**CA-04 — Artefacto sin format_version rechazado**
Dado un artefacto JSON sin campo `format_version`, cuando se envía al endpoint de validación o migración, entonces se rechaza con un error claro que indica que `format_version` es obligatorio.

**CA-05 — Artefacto con versión futura rechazado**
Dado un artefacto con `format_version` `99.0.0` (superior a la más reciente conocida), cuando se envía al endpoint de validación, entonces se rechaza con error indicando que la versión no es reconocida por esta versión de la plataforma.

**CA-06 — Compatibilidad backward dentro del mismo major**
Dado un artefacto con `format_version` `1.0.0` y una plataforma con formato actual `1.2.0`, cuando se envía al endpoint de validación, entonces el resultado es `valid` o `valid_with_warnings` (no requiere migración).

**CA-07 — Migración entre major versions**
Dado un artefacto con `format_version` de un major anterior y al menos una migración registrada para esa transición, cuando se envía al endpoint de migración, entonces se recibe el artefacto transformado con `format_version` actualizada a la versión actual y metadata de migración (`_migration_metadata`) indicando la cadena aplicada.

**CA-08 — Cadena de migraciones secuencial**
Dado un artefacto que requiere múltiples migraciones (p. ej., `1.0.0 → 2.0.0 → 3.0.0`), cuando se migra, entonces las migraciones se aplican en orden y el artefacto resultante es conforme al esquema de la versión final.

**CA-09 — Fallo en migración intermedia detiene la cadena**
Dado un artefacto que requiere tres migraciones y la segunda falla, cuando se intenta migrar, entonces el endpoint reporta el error indicando el paso de migración que falló. No se devuelve un artefacto parcialmente migrado.

**CA-10 — Preservación de campos desconocidos**
Dado un artefacto con campos adicionales no definidos en el esquema de su versión, cuando se valida, entonces el resultado es `valid_with_warnings` con advertencias sobre los campos desconocidos, pero el artefacto no se rechaza.

**CA-11 — Advertencias de migración por pérdida de información**
Dado una migración que transforma una estructura sin mapeo exacto, cuando se ejecuta, entonces el artefacto migrado contiene una sección `_migration_warnings` que describe la información afectada.

**CA-12 — Endpoint de versiones soportadas**
Cuando un superadmin consulta el endpoint de versiones soportadas, entonces la respuesta incluye: versión actual del formato, versión mínima migrable, y lista de versiones intermedias con resumen de cambios.

**CA-13 — Checksum de integridad en artefacto exportado**
Dado un artefacto exportado por US-BKP-02-T01 con la versión actual del formato, cuando se inspecciona la metadata raíz, entonces contiene un campo `schema_checksum` con un hash del esquema utilizado.

**CA-14 — Evento de auditoría por validación**
Dada una validación de artefacto (exitosa o fallida), cuando se completa, entonces existe un evento de auditoría en el pipeline con: actor, `format_version`, resultado, timestamp y correlation-id.

**CA-15 — Evento de auditoría por migración**
Dada una migración de artefacto, cuando se completa, entonces existe un evento de auditoría en el pipeline con: actor, versión origen, versión destino, cadena de migraciones, presencia de warnings, timestamp y correlation-id.

**CA-16 — Determinismo de las migraciones**
Dado el mismo artefacto de entrada, cuando se ejecuta la misma migración dos veces, entonces los artefactos de salida son idénticos (excluyendo timestamps de proceso si los hubiera).

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | La definición del esquema inicial puede no capturar todas las variaciones reales que los recolectores de T01 producen, causando artefactos válidos que no pasan validación | Media | Alto | Validar el esquema contra artefactos reales generados por T01 en diferentes escenarios (todos los dominios, dominios vacíos, errores, not_available) como parte de la implementación. |
| R-02 | Las migraciones entre major versions pueden ser complejas si los cambios de estructura afectan a múltiples dominios simultáneamente | Media | Medio | Mantener migraciones atómicas por versión (no saltar versiones). Documentar claramente qué cambió en cada versión. Diseñar las migraciones como funciones puras testables de forma aislada. |
| R-03 | La preservación de campos desconocidos puede interferir con migraciones si los campos no estándar colisionan con campos introducidos en versiones posteriores | Baja | Medio | Reservar un namespace para campos custom (p. ej., prefijo `_x_`) y tratar campos sin prefijo no reconocidos como advertencias. |
| R-04 | El registro de esquemas puede crecer y añadir complejidad operativa si no se establece una política de sunset para versiones muy antiguas | Baja | Bajo | Documentar una política de soporte de versiones (p. ej., soporte de migraciones solo para los últimos N major versions). No bloquea esta tarea. |

### 7.2 Supuestos

**S-01**: El artefacto JSON producido por US-BKP-02-T01 sigue la estructura definida en RF-T01-08 (metadata raíz + secciones por dominio) y esa estructura se formaliza como la versión `1.0.0` del esquema en esta tarea.

**S-02**: La cadena de migraciones se aplica en tiempo de operación (antes de importar), no como parte de un pipeline batch. El volumen de artefactos a migrar en una sesión es bajo (unidades, no miles).

**S-03**: JSON Schema (draft 2020-12 o compatible) es un formato aceptable para definir el esquema formal del artefacto. Si la tecnología final difiere, el requisito funcional se mantiene: debe existir una definición formal validable programáticamente.

**S-04**: El pipeline de auditoría (US-OBS-01) acepta eventos de validación y migración con la misma interfaz usada por la exportación en T01.

**S-05**: En el lanzamiento inicial, solo existirá la versión `1.0.0` del formato. La infraestructura de migraciones se construye pero las migraciones reales se crearán cuando el formato evolucione.

### 7.3 Preguntas abiertas

**P-01 — ¿El esquema se distribuye como parte del artefacto desplegable o como recurso separado?**
El esquema podría estar embebido en el código del producto o publicarse como un artefacto independiente (p. ej., un paquete npm, un recurso estático). Esto afecta cómo herramientas externas pueden validar artefactos offline.
*No bloquea la especificación*; puede resolverse en plan/implementación.

**P-02 — ¿Se debe soportar validación offline (sin conexión a la plataforma)?**
Si el esquema se publica como recurso independiente, un operador podría validar artefactos con herramientas estándar de JSON Schema sin necesidad de invocar el endpoint de la plataforma.
*No bloquea la especificación*; es una decisión de distribución.

**P-03 — ¿Cuál es la política de sunset para versiones de formato antiguas?**
¿Cuántas major versions hacia atrás debe soportar la cadena de migraciones? Mantener migraciones indefinidamente aumenta la superficie de mantenimiento.
*No bloquea la especificación*; puede establecerse como política operativa.

---

*Documento generado para el stage `speckit.specify` — US-BKP-02-T02 | Rama: `116-versioned-export-import-format`*
