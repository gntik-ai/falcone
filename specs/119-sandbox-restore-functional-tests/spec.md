# Especificación — US-BKP-02-T05: Pruebas de restauración funcional parcial y total en entornos sandbox

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-02-T05                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-02 — Exportación de configuración funcional y reprovisionamiento de tenants |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-003, RF-BKP-004                                               |
| **Dependencias**    | US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02, US-BKP-02-T03, US-BKP-02-T04 |

**Feature Branch**: `119-sandbox-restore-functional-tests`
**Created**: 2026-04-01
**Status**: Draft

---

## 1. Objetivo y problema que resuelve

### Problema

Las tareas US-BKP-02-T01 a T04 construyen la cadena completa de exportación, formato versionado, reaprovisionamiento y validación previa de conflictos para la configuración funcional de tenants. Sin embargo, **no existe un conjunto estructurado de pruebas que verifique de extremo a extremo que esta cadena funciona correctamente** en escenarios realistas de restauración parcial y total dentro de entornos sandbox.

Sin estas pruebas:

1. **No hay garantía verificable de que el flujo export → validate → reprovision produce un tenant funcional equivalente** al original. Cada tarea individual puede tener sus propias pruebas unitarias o de integración, pero ninguna valida la cadena completa como la ejecutaría un operador real.
2. **Los escenarios de restauración parcial (solo algunos dominios) no están cubiertos sistemáticamente**. Un SRE que restaura solo IAM y PostgreSQL pero no Kafka ni funciones necesita confianza en que el resultado es un tenant coherente con los dominios restaurados funcionando y los no restaurados sin interferencia.
3. **Los edge cases operativos de la restauración** — artefactos con dominios en estado `error` o `not_available`, restauración sobre tenants que ya tienen configuración parcial, y restauración tras un fallo parcial previo — no tienen cobertura de prueba dedicada.
4. **La confianza operativa en el procedimiento de disaster recovery es baja sin evidencia de pruebas periódicas ejecutables** en entornos sandbox que simulen escenarios reales.

### Objetivo de esta tarea

Definir y especificar un conjunto de pruebas de restauración funcional que verifiquen el flujo completo de export → (validación previa de conflictos) → reprovisionamiento en entornos sandbox, cubriendo restauración total (todos los dominios) y restauración parcial (subconjunto de dominios seleccionados), incluyendo escenarios de éxito, degradación parcial, conflictos conocidos y recuperación ante fallos.

El resultado es que el equipo de plataforma disponga de un catálogo de pruebas ejecutables y reproducibles que validen la capacidad real de restauración funcional del producto, proporcionando confianza operativa medible para los procedimientos de DR (Disaster Recovery) y migración.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecuta las pruebas periódicamente en entornos sandbox como validación de DR | Confianza operativa verificable de que los procedimientos de restauración funcionan antes de necesitarlos en una emergencia real. Reducción del riesgo de descubrir fallos en la cadena de restauración durante un incidente. |
| **Superadmin** | Revisa resultados de las pruebas como evidencia de preparación operativa | Visibilidad del estado de salud de la capacidad de restauración, con informes claros de qué escenarios pasan y cuáles fallan. |
| **QA / Platform team** | Diseña, mantiene y extiende las pruebas como parte del ciclo de calidad | Un catálogo estructurado de escenarios que se puede ejecutar de forma automatizada, evitando pruebas ad-hoc manuales cada vez que cambia la cadena de backup/restore. |
| **Proceso interno (CI/CD)** | Ejecuta las pruebas automáticamente como gate de calidad | Detección temprana de regresiones en la cadena de exportación/reaprovisionamiento cuando se modifica cualquiera de las tareas T01-T04. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Restauración total sobre tenant vacío (golden path)**

> Se parte de un tenant de referencia completamente aprovisionado en el sandbox, con configuración en los seis dominios (IAM, PostgreSQL metadata, MongoDB metadata, Kafka topics/ACLs, funciones OpenWhisk, buckets/políticas S3). Se exporta su configuración completa. Se crea un tenant nuevo y vacío. Se ejecuta la validación previa de conflictos (T04), que debe reportar cero conflictos y riesgo `low`. Se ejecuta el reaprovisionamiento completo (T03). Se verifica que el tenant destino tiene configuración funcional equivalente al original en todos los dominios exportados.

**E2 — Restauración parcial: solo dominios seleccionados**

> Se exporta la configuración completa de un tenant de referencia. Se crea un tenant vacío. Se ejecuta el reaprovisionamiento solicitando solo un subconjunto de dominios (por ejemplo, IAM + PostgreSQL metadata). Se verifica que los dominios solicitados se restauraron correctamente y que los dominios no solicitados permanecen vacíos sin errores ni artefactos residuales.

**E3 — Restauración total sobre tenant con configuración preexistente (con conflictos)**

> Se parte de un tenant destino que ya tiene configuración parcial en algunos dominios. Se ejecuta la validación previa de conflictos, que reporta conflictos clasificados por severidad. Se ejecuta el reaprovisionamiento. Se verifica que los recursos sin conflicto se aplicaron correctamente y que los conflictos se reportaron como `conflict` sin modificar los recursos existentes.

**E4 — Restauración con artefacto que contiene dominios degradados**

> Se exporta un tenant donde algún dominio retornó estado `error` o `not_available` (por ejemplo, MongoDB deshabilitado con `CONFIG_EXPORT_MONGO_ENABLED=false`). Se ejecuta el reaprovisionamiento. Se verifica que los dominios con datos válidos se restauraron, que los dominios con estado `error` o `not_available` se omitieron sin bloquear el proceso, y que el informe final refleja claramente qué dominios se aplicaron y cuáles se saltaron.

**E5 — Restauración con migración de formato**

> Se genera un artefacto con un formato anterior (si existe una migración disponible en T02). Se valida que el artefacto se migra automáticamente al formato vigente antes de la aplicación. Se ejecuta el reaprovisionamiento y se verifica que el resultado es equivalente al de un artefacto nativo del formato actual.

### 3.2 Edge cases

**EC1 — Fallo parcial durante reaprovisionamiento y reintento posterior**

> Durante la restauración total, uno de los dominios falla (por ejemplo, Kafka no está disponible temporalmente). Se verifica que los dominios ya aplicados no se deshacen, que el dominio fallido se reporta como `error`, y que un reintento posterior del reaprovisionamiento (solo para el dominio fallido) completa la restauración sin afectar los dominios ya aplicados.

**EC2 — Artefacto con tenant de origen inexistente en entorno destino**

> El artefacto fue exportado de un tenant que no existe en el entorno destino. Se verifica que el mapa de identificadores del reaprovisionamiento refleja correctamente los identificadores del tenant destino y que la restauración funciona con los identificadores ajustados.

**EC3 — Restauración concurrente bloqueada**

> Dos operadores intentan restaurar sobre el mismo tenant simultáneamente. Se verifica que el mecanismo de lock de concurrencia de T03 impide la ejecución simultánea y que el segundo intento recibe un error claro indicando que hay una operación en curso.

**EC4 — Artefacto con tamaño máximo permitido**

> Se verifica que un artefacto que se acerca al límite de `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` (10 MB por defecto) se puede exportar, validar y restaurar sin errores de truncamiento ni timeouts.

**EC5 — Restauración sobre tenant en estado suspendido**

> Se intenta restaurar configuración sobre un tenant con estado `suspended`. Se verifica que el sistema rechaza la operación con un error claro indicando que el tenant debe estar en estado `active`.

### 3.3 Reglas de negocio y gobierno

| Regla | Descripción |
|---|---|
| **RN-01** | Las pruebas deben ejecutarse exclusivamente en entornos sandbox o de integración, nunca contra tenants de producción. |
| **RN-02** | Cada escenario de prueba debe ser autocontenido: crea sus propios tenants de referencia, exporta, restaura y limpia al finalizar. |
| **RN-03** | La verificación de equivalencia funcional compara la configuración del tenant restaurado contra el artefacto de origen, no contra el tenant de origen directamente (el tenant de origen podría haber cambiado). |
| **RN-04** | Las pruebas parciales deben verificar tanto los dominios restaurados como la ausencia de efectos laterales en los dominios no restaurados. |
| **RN-05** | Los resultados de las pruebas deben quedar registrados como eventos de auditoría con correlation-id trazable. |
| **RN-06** | Las pruebas deben respetar el modelo de permisos existente: el actor que ejecuta las pruebas debe tener los mismos roles que un SRE ejecutaría en un escenario real (`superadmin`, `sre` o `service_account` con scope `platform:admin:config:export`). |

---

## 4. Requisitos funcionales verificables

### RF-T05-001: Catálogo de escenarios de prueba ejecutables

El sistema debe disponer de un catálogo de escenarios de prueba para restauración funcional que cubra al menos:

- Restauración total sobre tenant vacío (E1).
- Restauración parcial por subconjunto de dominios (E2).
- Restauración sobre tenant con conflictos (E3).
- Restauración con dominios degradados en el artefacto (E4).
- Restauración con migración de formato de artefacto (E5).
- Fallo parcial y reintento (EC1).

Cada escenario debe tener: precondiciones, pasos, postcondiciones verificables y criterio de éxito/fallo.

### RF-T05-002: Verificación de equivalencia funcional

Las pruebas de restauración total (E1) deben verificar la equivalencia funcional del tenant restaurado comparando, dominio por dominio, la configuración del tenant destino contra el contenido del artefacto de exportación de origen. La comparación debe:

- Excluir identificadores internos que se espera que difieran (IDs de realm, schema prefix, namespace, etc.).
- Incluir la estructura funcional: roles y scopes IAM, tablas/columnas/índices en PostgreSQL metadata, colecciones/índices en MongoDB metadata, topics y ACLs en Kafka, funciones y paquetes en OpenWhisk, buckets y políticas en S3.
- Reportar diferencias encontradas como fallos de prueba con detalle del dominio, recurso y campo que difiere.

### RF-T05-003: Verificación de aislamiento en restauración parcial

Las pruebas de restauración parcial (E2) deben verificar que:

- Los dominios solicitados contienen la configuración esperada del artefacto.
- Los dominios no solicitados permanecen en su estado anterior (vacíos si el tenant era nuevo, intactos si tenía configuración previa).
- No existen artefactos residuales, registros de auditoría erróneos ni efectos laterales en dominios no restaurados.

### RF-T05-004: Verificación de manejo de conflictos

Las pruebas sobre tenants con configuración preexistente (E3) deben verificar que:

- La validación previa (T04) detecta y clasifica correctamente los conflictos.
- El reaprovisionamiento (T03) aplica los recursos sin conflicto y reporta los conflictos sin modificar recursos existentes.
- El informe final del reaprovisionamiento coincide con el informe de conflictos de la validación previa.

### RF-T05-005: Verificación de degradación elegante

Las pruebas con artefactos degradados (E4) deben verificar que:

- Los dominios con datos válidos se restauran correctamente.
- Los dominios con estado `error`, `not_available` o `not_requested` se omiten sin error.
- El informe final indica claramente qué dominios se aplicaron, cuáles se omitieron y el motivo.

### RF-T05-006: Prueba de fallo parcial y recuperación

La prueba de fallo parcial (EC1) debe verificar que:

- Un fallo en un dominio no revierte los dominios ya aplicados exitosamente.
- El dominio fallido queda marcado como `error` en el resultado.
- Un reintento selectivo del dominio fallido (una vez disponible el subsistema) completa la restauración.

### RF-T05-007: Ejecución reproducible y autocontenida

Cada prueba debe:

- Crear su propio tenant de referencia con datos seed apropiados al escenario.
- Ejecutar la exportación, validación previa y reaprovisionamiento usando las APIs del producto.
- Verificar los resultados mediante las APIs de consulta del producto (no mediante acceso directo a bases de datos internas).
- Limpiar los tenants creados al finalizar (tanto origen como destino).

### RF-T05-008: Informe de resultados estructurado

La ejecución del conjunto de pruebas debe producir un informe estructurado que contenga:

- Nombre y descripción de cada escenario ejecutado.
- Estado de cada escenario: `pass`, `fail` o `skip` (si las precondiciones no se cumplen).
- Duración de cada escenario.
- Detalle de fallos: dominio, recurso, campo, valor esperado vs. valor obtenido.
- Resumen global: total de escenarios, pasados, fallidos, omitidos.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### Permisos

- Las pruebas deben ejecutarse con credenciales de actor autorizado: `superadmin`, `sre` o `service_account` con scope `platform:admin:config:export`.
- Las pruebas no deben requerir credenciales adicionales más allá de las necesarias para las APIs de exportación (T01), validación previa (T04) y reaprovisionamiento (T03).

### Aislamiento multi-tenant

- Los tenants creados para prueba deben estar aislados: no deben compartir recursos con tenants de producción ni con otras ejecuciones de prueba concurrentes.
- Cada ejecución de prueba debe usar identificadores únicos para sus tenants de referencia y destino (basados en timestamp o UUID) para evitar colisiones.

### Auditoría

- Todas las operaciones realizadas durante las pruebas (exportaciones, validaciones previas, reaprovisionamientos, creación y eliminación de tenants) deben generar los eventos de auditoría correspondientes, con un correlation-id compartido por ejecución de prueba para trazabilidad.

### Seguridad

- Los artefactos de exportación generados durante las pruebas deben pasar por el mismo pipeline de redacción de secretos que en operación normal: no deben contener credenciales, tokens ni secretos en claro.
- Los tenants de prueba deben eliminarse (cleanup) al finalizar cada ejecución para no dejar datos residuales en el entorno sandbox.

---

## 6. Criterios de aceptación

### CA-01: Restauración total verificada

Se puede ejecutar una prueba de restauración total (E1) que exporta un tenant de referencia con los seis dominios, lo restaura sobre un tenant vacío, y verifica la equivalencia funcional dominio por dominio. La prueba pasa sin intervención manual.

### CA-02: Restauración parcial verificada

Se puede ejecutar una prueba de restauración parcial (E2) con al menos dos combinaciones distintas de dominios (por ejemplo: solo IAM + PostgreSQL; solo Kafka + funciones). Cada combinación verifica que los dominios solicitados se restauraron y los no solicitados no se modificaron.

### CA-03: Conflictos detectados y manejados

Se puede ejecutar una prueba sobre un tenant con configuración preexistente (E3) donde la validación previa detecta al menos un conflicto, y el reaprovisionamiento respeta la política de no modificar recursos en conflicto.

### CA-04: Degradación elegante verificada

Se puede ejecutar una prueba con un artefacto que contiene al menos un dominio con estado `not_available` (E4), y la restauración completa los dominios válidos sin error.

### CA-05: Fallo parcial y recuperación verificados

Se puede simular un fallo en un dominio durante el reaprovisionamiento (EC1) y verificar que el reintento selectivo completa la restauración.

### CA-06: Pruebas autocontenidas y limpias

Cada prueba crea y destruye sus propios tenants sin dejar recursos residuales en el entorno sandbox después de la ejecución.

### CA-07: Informe de resultados disponible

La ejecución completa del catálogo de pruebas produce un informe estructurado con el resultado de cada escenario, duración y detalle de fallos.

---

## 7. Límites de alcance

### Dentro del alcance

- Especificación de escenarios de prueba para restauración funcional parcial y total.
- Verificación de la cadena completa: export (T01) → formato versionado (T02) → validación previa (T04) → reaprovisionamiento (T03).
- Pruebas en entornos sandbox con tenants creados ad-hoc.
- Verificación de equivalencia funcional, manejo de conflictos, degradación elegante y recuperación ante fallos.

### Fuera del alcance

- **Restauración de datos de usuario** (filas de tablas, documentos, objetos almacenados): esta tarea cubre solo configuración funcional.
- **Pruebas de rendimiento o carga** de la cadena de restauración: se limita a pruebas funcionales.
- **Documentación de diferencias entre restauración de configuración y restauración de datos**: corresponde a US-BKP-02-T06.
- **Implementación de nuevas capacidades en T01-T04**: las pruebas verifican las capacidades existentes, no las extienden.
- **Ejecución contra entornos de producción**: las pruebas están diseñadas exclusivamente para sandbox/integración.

---

## 8. Riesgos, supuestos y preguntas abiertas

### Supuestos

| ID | Supuesto |
|---|---|
| **S-01** | Las APIs de exportación (T01), validación previa (T04) y reaprovisionamiento (T03) están disponibles y funcionales en el entorno sandbox donde se ejecutarán las pruebas. |
| **S-02** | El entorno sandbox tiene habilitados los mismos dominios que el entorno de referencia (al menos IAM, PostgreSQL y Kafka; MongoDB, OpenWhisk y S3 según configuración de despliegue). |
| **S-03** | Existe capacidad para crear y destruir tenants en el sandbox sin restricciones de cuota que impidan la ejecución de múltiples escenarios. |
| **S-04** | El formato de artefacto vigente es `1.0.0` (semver, según T02). Si existen migraciones de formato, al menos una migración de ejemplo está disponible para probar E5. |

### Riesgos

| ID | Riesgo | Mitigación |
|---|---|---|
| **R-01** | Los entornos sandbox pueden tener configuraciones de despliegue que deshabilitan dominios opcionales (MongoDB, OpenWhisk), lo que reduce la cobertura de prueba. | Las pruebas deben adaptarse dinámicamente a los dominios disponibles: consultar el endpoint de dominios exportables (T01) y ajustar las expectativas. |
| **R-02** | La simulación de fallos parciales (EC1) puede ser difícil de reproducir de forma determinista en un entorno sandbox estándar. | Diseñar el escenario de fallo parcial de forma que se pueda provocar deshabilitando temporalmente un dominio opcional o usando un artefacto con datos inválidos para un dominio específico. |
| **R-03** | La limpieza de tenants al finalizar puede fallar, dejando recursos residuales. | Implementar un mecanismo de cleanup robusto con reintentos y un identificador de ejecución que permita limpieza manual posterior si es necesario. |
