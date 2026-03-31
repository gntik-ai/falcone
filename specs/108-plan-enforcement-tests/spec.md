# Especificación — US-PLAN-02-T06: Pruebas de Enforcement Coherente de Capabilities y Cuotas por Plan

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-PLAN-02-T06                                                        |
| **Epic**            | EP-19 — Planes, límites y packaging del producto                      |
| **Historia**        | US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo |
| **Tipo**            | Feature (suite de pruebas de validación end-to-end)                   |
| **Prioridad**       | P0                                                                    |
| **Tamaño**          | M                                                                     |
| **Dependencias**    | US-PLAN-01, US-OBS-03, US-PLAN-02-T01, US-PLAN-02-T02, US-PLAN-02-T03, US-PLAN-02-T04, US-PLAN-02-T05 |

---

## 1. Objetivo y problema que resuelve

### Problema

Las tareas T01 a T05 de US-PLAN-02 han construido cinco subsistemas complementarios:

| Tarea | Capacidad |
|-------|-----------|
| T01 (spec 103) | Cuotas hard/soft con overrides y grace margins |
| T02 (spec 104) | Capabilities booleanas por plan con catálogo gobernado |
| T03 (spec 105) | Resolución de límites efectivos (plan → override → catalog default) y subcuotas de workspace |
| T04 (spec 106) | Visualización en consola de plan, consumo y capabilities |
| T05 (spec 107) | Enforcement activo de capabilities en gateway, control plane y consola |

Cada tarea ha sido especificada y puede validarse individualmente. Sin embargo, **no existe hoy una suite de pruebas que verifique que estos cinco subsistemas funcionan de forma coherente entre sí** cuando se combinan en escenarios realistas de ciclo de vida de un tenant. Los riesgos concretos son:

1. **Inconsistencia entre resolución y enforcement**: El cálculo de límites efectivos (T03) podría devolver un valor diferente al que el gateway (T05) o la consola (T04/T06) observan.
2. **Regresiones silenciosas al cambiar plan/override**: Un cambio de plan (upgrade/downgrade) o la creación/revocación de un override podría actualizar correctamente T01/T02 pero no propagarse a T03/T05 dentro del TTL aceptable.
3. **Coherencia cuota-capability**: Un tenant podría tener una capability habilitada (p. ej., `webhooks: true`) pero la cuota asociada bloqueada (p. ej., `max_webhooks: 0`), o viceversa — sin que ningún subsistema detecte la contradicción.
4. **Drift entre consola y gateway**: La consola podría mostrar una capacidad como disponible mientras el gateway la bloquea, o al revés, debido a diferencias en caché o en el contrato consumido.

### Objetivo

Especificar una **suite de pruebas de integración cross-subsistema** que verifique la coherencia de enforcement de capabilities booleanas y cuotas numéricas por plan, a lo largo de escenarios de ciclo de vida realistas. Las pruebas deben cubrir:

- La coherencia entre resolución de entitlements y enforcement real.
- La correcta propagación de cambios (plan, override, subcuota) a todos los puntos de consumo.
- La ausencia de contradicciones entre capabilities y cuotas relacionadas.
- La alineación entre lo que la consola muestra y lo que el gateway/API permite.

Esta tarea **no implementa funcionalidad nueva de producto**. Produce artefactos de verificación (especificaciones de pruebas) que pueden ejecutarse contra la plataforma desplegada.

---

## 2. Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor recibido |
|-------|-------------------------|----------------|
| **Equipo de desarrollo** | Ejecuta las pruebas en CI/CD y en despliegues | Detección temprana de regresiones entre subsistemas de plan y enforcement. |
| **QA / Test engineer** | Diseña y mantiene la suite | Cobertura verificable y reproducible del comportamiento end-to-end del sistema de planes. |
| **Product owner** | Valida que el packaging de planes funciona como se define comercialmente | Confianza en que los planes no solo están configurados sino efectivamente aplicados. |
| **Superadmin** | Gestiona overrides y planes | Garantía de que sus cambios se propagan coherentemente a gateway, consola y resolución. |
| **Tenant owner** | Consume el producto bajo un plan | Experiencia coherente: lo que ve en consola coincide con lo que puede hacer via API. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales de coherencia

**E1 — Coherencia plan → resolución → gateway → consola (happy path)**

> Dado un tenant asignado al plan `professional` que habilita `realtime`, `webhooks` y `sql_admin_api`, y define cuotas `max_workspaces: 10 (hard)`, `max_pg_databases: 20 (hard)`, `max_kafka_topics: 50 (soft, grace: 10)`:
>
> 1. El endpoint de resolución de entitlements (T03) devuelve exactamente esas capabilities y cuotas con source `plan`.
> 2. El gateway (T05) permite `POST /webhooks`, `POST /realtime/subscribe`, `POST /admin/sql`.
> 3. El gateway bloquea la creación del workspace nº 11 con error `QUOTA_HARD_LIMIT_REACHED`.
> 4. La consola (T04) muestra las 3 capabilities como habilitadas y las cuotas con sus límites y consumo actual.
> 5. La consola (T05) no deshabilita las secciones de webhooks, realtime ni SQL admin.

**E2 — Coherencia tras upgrade de plan**

> Dado un tenant en plan `starter` (sin `realtime`, `max_workspaces: 3`), cuando el superadmin cambia el plan a `professional` (`realtime: true`, `max_workspaces: 10`):
>
> 1. Transcurrido el TTL de invalidación, el endpoint de resolución devuelve `realtime: true` y `max_workspaces: 10`.
> 2. El gateway permite `POST /realtime/subscribe` (antes lo bloqueaba).
> 3. El gateway permite crear workspaces hasta 10 (antes bloqueaba en 3).
> 4. La consola muestra `realtime` como habilitado y el límite de workspaces actualizado.

**E3 — Coherencia tras downgrade de plan**

> Dado un tenant en plan `professional` con 8 workspaces y `realtime: true`, cuando el superadmin cambia el plan a `starter` (`realtime: false`, `max_workspaces: 3`):
>
> 1. El endpoint de resolución devuelve `realtime: false` y `max_workspaces: 3`.
> 2. El gateway bloquea `POST /realtime/subscribe` con `HTTP 402`.
> 3. El gateway bloquea la creación de nuevos workspaces (ya está en 8/3, over-limit).
> 4. La consola muestra `realtime` como deshabilitado y el indicador de over-limit para workspaces.
> 5. Los 8 workspaces existentes **no se eliminan** pero no se pueden crear más.

**E4 — Coherencia con override habilitante**

> Dado un tenant en plan `starter` (`webhooks: false`), cuando el superadmin crea un override `webhooks: true` para ese tenant:
>
> 1. El endpoint de resolución devuelve `webhooks: true (source: override)`.
> 2. El gateway permite `POST /webhooks`.
> 3. La consola muestra la sección de webhooks como habilitada.

**E5 — Coherencia con override restrictivo**

> Dado un tenant en plan `professional` (`sql_admin_api: true`), cuando el superadmin crea un override `sql_admin_api: false` para ese tenant:
>
> 1. El endpoint de resolución devuelve `sql_admin_api: false (source: override)`.
> 2. El gateway bloquea `POST /admin/sql` con error estandarizado.
> 3. La consola deshabilita la sección de SQL admin con indicador de restricción.

**E6 — Coherencia cuota + override numérico**

> Dado un tenant en plan `starter` (`max_pg_databases: 5, hard`), cuando el superadmin crea un override elevando a `max_pg_databases: 15`:
>
> 1. El endpoint de resolución devuelve `max_pg_databases: 15 (source: override)`.
> 2. El gateway permite crear bases de datos hasta 15.
> 3. La consola muestra el límite como 15 con indicador de override.
> 4. Al revocar el override, el límite efectivo vuelve a 5, y si el consumo es 12, se muestra condición over-limit.

**E7 — Coherencia soft quota + grace margin**

> Dado un tenant con `max_kafka_topics: 20 (soft, grace: 5)` y consumo actual 20:
>
> 1. La creación del topic 21 tiene éxito + warning header + evento `quota.soft_limit.exceeded`.
> 2. La creación del topic 26 es bloqueada con `QUOTA_SOFT_LIMIT_GRACE_EXHAUSTED`.
> 3. La consola muestra consumo `20/20` con indicador de grace zone activa.
> 4. Si el plan se cambia a uno con `max_kafka_topics: 30 (hard)`, el consumo 20 ya no está en zona de gracia y las pruebas verifican la transición.

**E8 — Coherencia workspace subcuota + tenant limit**

> Dado un tenant con `max_pg_databases: 10 (effective)` y workspaces `ws-prod` (subcuota: 6) y `ws-dev` (subcuota: 4):
>
> 1. `ws-prod` puede crear hasta 6 databases y la 7ª es bloqueada.
> 2. `ws-dev` puede crear hasta 4 databases y la 5ª es bloqueada.
> 3. La consola muestra las subcuotas y la asignación total (10/10 = 100% asignado).
> 4. Si el superadmin reduce el límite del tenant a 8 (via override restrictivo), las subcuotas 6+4=10 > 8 se señalizan como inconsistentes pero no se modifican automáticamente.

### 3.2 Edge cases a cubrir en la suite de pruebas

| ID | Edge case | Comportamiento esperado verificable |
|----|-----------|-------------------------------------|
| EC-01 | Tenant sin plan asignado | Todas las capabilities `false`, cuotas en catalog default, gateway bloquea rutas premium, consola muestra "sin plan". |
| EC-02 | Capability habilitada pero cuota asociada en 0 | La capability permite acceder a la ruta pero la cuota bloquea la creación del recurso. Ambas respuestas son correctas y no contradictorias: la ruta es accesible pero el recurso no se puede crear. |
| EC-03 | Cuota unlimited (`-1`) + capability deshabilitada | El gateway bloquea la ruta por capability (no se llega a evaluar cuota). La consola oculta/deshabilita la sección. |
| EC-04 | Override habilitante + override numérico simultáneos | Ambos se reflejan coherentemente: la capability se habilita Y el límite numérico se eleva. |
| EC-05 | Expiración de override durante ejecución de prueba | Tras expirar, resolución vuelve a plan base, gateway y consola reflejan el cambio. |
| EC-06 | Cambio de plan + override preexistente | El override sigue activo. Las capabilities y cuotas del nuevo plan se combinan con el override. |
| EC-07 | Degradación del servicio de resolución | Gateway aplica deny-by-default; consola muestra error de carga de capabilities, no datos stale. |
| EC-08 | Concurrencia: cambio de plan mientras request en vuelo | El request en vuelo usa el estado resuelto al momento de su evaluación. Requests posteriores reflejan el nuevo plan. |
| EC-09 | Workspace sin subcuota consume del pool compartido del tenant | La creación de recurso tiene éxito mientras el total del tenant no exceda el límite efectivo. |
| EC-10 | Subcuota de workspace excede nuevo límite efectivo tras downgrade | La subcuota se marca como inconsistente; la consola muestra warning; el enforcement usa la subcuota existente hasta remedación. |

### 3.3 Reglas de negocio verificadas por las pruebas

**RN-V01 — Principio de coherencia total**
Para cualquier tenant y en cualquier momento, el mapa de entitlements que devuelve la resolución (T03) DEBE ser el mismo que el gateway (T05) aplica y la consola (T04) muestra. Las diferencias solo son aceptables dentro de la ventana de TTL documentada.

**RN-V02 — Precedencia de override es universal**
La jerarquía override > plan > catalog default se aplica de forma idéntica en resolución, gateway y consola. No hay un subsistema que ignore los overrides.

**RN-V03 — Deny-by-default es universal**
Ante cualquier fallo en la resolución de capabilities o cuotas, todos los puntos de control (gateway, consola, API) deben denegar acceso, no permitirlo silenciosamente.

**RN-V04 — Los cambios de estado se propagan a todos los consumidores**
Un cambio de plan, override o subcuota debe reflejarse en resolución, gateway y consola dentro del TTL configurado. No hay un subsistema que retenga estado stale más allá de ese TTL.

**RN-V05 — Las capabilities y cuotas son ortogonales pero complementarias**
Una capability habilita el acceso a una funcionalidad. Una cuota limita la cantidad de uso de esa funcionalidad. Ambas se evalúan y ambas pueden bloquear, pero por razones distintas y con errores distintos.

---

## 4. Requisitos funcionales verificables

### 4.1 Requisitos de la suite de pruebas

**RF-T06-01 — Pruebas de coherencia resolución-gateway**
La suite DEBE incluir pruebas que, para cada capability booleana reconocida en el catálogo, verifiquen que el resultado de la resolución de entitlements y la decisión del gateway son idénticos (habilitado → permite ruta; deshabilitado → bloquea ruta).

**RF-T06-02 — Pruebas de coherencia resolución-consola**
La suite DEBE incluir pruebas que verifiquen que el estado de capabilities y cuotas mostrado en la consola (visible/habilitado/deshabilitado, límites, consumo) coincide con el resultado de la resolución de entitlements.

**RF-T06-03 — Pruebas de coherencia gateway-consola**
La suite DEBE incluir al menos una prueba que verifique que, para una capability deshabilitada, tanto el gateway como la consola coinciden en el rechazo/ocultación, y que para una capability habilitada, ambos coinciden en permitir/mostrar.

**RF-T06-04 — Pruebas de propagación de cambio de plan**
La suite DEBE incluir pruebas que verifiquen que un cambio de plan (upgrade y downgrade) se refleja en resolución, gateway y consola dentro del TTL configurado. Se mide el tiempo entre el cambio y la primera respuesta coherente.

**RF-T06-05 — Pruebas de propagación de override**
La suite DEBE incluir pruebas que verifiquen que la creación, modificación, revocación y expiración de overrides (tanto booleanos como numéricos) se reflejan coherentemente en los tres subsistemas.

**RF-T06-06 — Pruebas de enforcement de cuotas hard**
La suite DEBE incluir pruebas que verifiquen que una cuota hard bloquea la creación del recurso N+1 cuando el consumo alcanza N = límite efectivo, y que el bloqueo es coherente entre gateway y resolución.

**RF-T06-07 — Pruebas de enforcement de cuotas soft con grace**
La suite DEBE incluir pruebas que verifiquen que una cuota soft permite creación dentro de la grace margin (con warning), bloquea más allá de la grace margin, y que los eventos `quota.soft_limit.exceeded` se emiten correctamente.

**RF-T06-08 — Pruebas de coherencia workspace subcuota**
La suite DEBE incluir pruebas que verifiquen que las subcuotas de workspace se respetan en el enforcement y que la suma de subcuotas no puede exceder el límite efectivo del tenant al momento de la asignación.

**RF-T06-09 — Pruebas de inconsistencia por cambio upstream**
La suite DEBE incluir pruebas que verifiquen que cuando un cambio upstream (plan, override) invalida una subcuota existente, el sistema la señaliza como inconsistente sin modificarla automáticamente.

**RF-T06-10 — Pruebas de deny-by-default**
La suite DEBE incluir pruebas que verifiquen el comportamiento de deny-by-default cuando el subsistema de resolución no está disponible o falla.

**RF-T06-11 — Pruebas de auditoría de enforcement**
La suite DEBE incluir pruebas que verifiquen que cada rechazo por capability o cuota genera un evento de auditoría con los campos obligatorios definidos en T01 (RN-06 de spec 103) y T05 (sección 5.3 de spec 107).

**RF-T06-12 — Pruebas de ortogonalidad capability-cuota**
La suite DEBE incluir pruebas que verifiquen los casos donde capability y cuota dan señales aparentemente contradictorias (EC-02, EC-03) y que el sistema se comporta de forma coherente y documentada.

**RF-T06-13 — Cobertura mínima de capabilities del catálogo**
La suite DEBE cubrir al menos las 7 capabilities iniciales del catálogo (`sql_admin_api`, `passthrough_admin`, `realtime`, `webhooks`, `public_functions`, `custom_domains`, `scheduled_functions`) en al menos un escenario de habilitación y uno de bloqueo cada una.

**RF-T06-14 — Pruebas reproducibles y deterministas**
Cada prueba DEBE poder ejecutarse de forma aislada, con setup y teardown explícitos del estado del tenant/plan/override, sin dependencia del orden de ejecución de otras pruebas.

**RF-T06-15 — Reporte de resultados estructurado**
La suite DEBE producir un reporte de resultados que indique, por cada prueba: nombre, escenario verificado, subsistemas involucrados, resultado (pass/fail), y detalle del fallo si aplica.

### 4.2 Requisitos no funcionales de las pruebas

**RNF-T06-01 — Ejecutabilidad en CI/CD**
La suite DEBE poder ejecutarse en un pipeline de integración continua sin intervención manual, contra un entorno de pruebas desplegado.

**RNF-T06-02 — Tiempo de ejecución acotado**
La suite completa DEBE completarse en menos de 15 minutos en un entorno estándar de CI. Las pruebas individuales DEBEN completarse en menos de 60 segundos (excluyendo el TTL de propagación que se espera explícitamente).

**RNF-T06-03 — Idempotencia**
La suite DEBE poder ejecutarse múltiples veces consecutivas contra el mismo entorno sin acumular estado residual que afecte resultados.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento en las pruebas

- Cada ejecución de la suite DEBE usar tenants de prueba dedicados, creados en el setup y limpiados en el teardown.
- Los tenants de prueba NO DEBEN compartir nombres, identificadores ni recursos con tenants de producción o de otras ejecuciones concurrentes.
- Las pruebas que verifican aislamiento multi-tenant DEBEN crear al menos dos tenants y confirmar que las operaciones y datos de uno son invisibles para el otro.

### 5.2 Permisos requeridos por la suite

| Operación de prueba | Actor requerido | Justificación |
|---------------------|-----------------|---------------|
| Crear/modificar planes de prueba | Superadmin | Necesario para configurar escenarios de plan |
| Crear/revocar overrides | Superadmin | Necesario para escenarios de override |
| Asignar plan a tenant | Superadmin | Necesario para setup de cada escenario |
| Crear recursos (workspaces, DBs, topics, etc.) | Tenant owner / Workspace admin | Necesario para provocar enforcement de cuotas |
| Acceder a rutas capability-gated | Tenant owner / Workspace admin | Necesario para provocar enforcement de capabilities en gateway |
| Consultar resolución de entitlements | Superadmin + Tenant owner | Necesario para verificar coherencia |
| Consultar consola (estado de UI) | Tenant owner / Workspace admin | Necesario para verificar coherencia visual |
| Consultar auditoría | Superadmin | Necesario para verificar eventos de enforcement |

### 5.3 Auditoría de las pruebas mismas

- La suite NO debe generar eventos de auditoría que se confundan con actividad real de operaciones. Los tenants/actores de prueba deben ser identificables (p. ej., prefijo `test-` en nombres de tenant).
- Los eventos de auditoría generados durante las pruebas DEBEN ser verificables como parte de las pruebas de RF-T06-11 y DEBEN limpiarse en el teardown si el entorno lo requiere.

### 5.4 Seguridad

- Las credenciales de prueba (tokens superadmin, tokens tenant) NO DEBEN estar hardcodeadas en los archivos de la suite. Deben inyectarse como variables de entorno o secretos de CI.
- Las pruebas NO DEBEN deshabilitar mecanismos de seguridad (autenticación, autorización, TLS) para facilitar la ejecución. Deben operar contra el sistema con seguridad habilitada.

---

## 6. Criterios de aceptación

**CA-01 — Coherencia resolución-gateway para capabilities**
Para cada una de las 7 capabilities del catálogo, existe al menos una prueba que verifica: (a) capability habilitada → gateway permite la ruta; (b) capability deshabilitada → gateway bloquea con error estandarizado; (c) el resultado es coherente con la resolución de entitlements. Las 7×2 = 14 verificaciones pasan.

**CA-02 — Coherencia resolución-consola para capabilities**
Para al menos 3 capabilities representativas, existe una prueba que verifica que el estado mostrado en la consola coincide con la resolución: habilitada → sección activa; deshabilitada → sección deshabilitada con indicador de restricción.

**CA-03 — Coherencia resolución-gateway para cuotas hard**
Existe al menos una prueba que verifica: tenant con cuota hard al límite → gateway bloquea creación → resolución confirma el mismo límite efectivo.

**CA-04 — Coherencia para cuotas soft con grace margin**
Existe al menos una prueba que verifica la transición: dentro de límite → en grace zone (permite + warning) → más allá de grace (bloquea). Los tres estados se verifican coherentemente entre resolución y gateway.

**CA-05 — Propagación de upgrade de plan**
Existe una prueba que: (a) verifica estado pre-upgrade; (b) ejecuta cambio de plan; (c) espera TTL; (d) verifica que resolución, gateway y consola reflejan el nuevo plan. La prueba pasa.

**CA-06 — Propagación de downgrade de plan**
Existe una prueba análoga a CA-05 para downgrade, incluyendo verificación de condición over-limit si el consumo excede los nuevos límites.

**CA-07 — Propagación de override habilitante y restrictivo**
Existen pruebas que verifican: (a) creación de override habilitante (capability) se propaga; (b) creación de override restrictivo (capability) se propaga; (c) creación de override numérico (cuota) se propaga; (d) revocación de override revierte al plan base.

**CA-08 — Expiración de override**
Existe una prueba que crea un override con expiración corta, espera la expiración + sweep cycle, y verifica que el override ya no aplica en resolución ni gateway.

**CA-09 — Deny-by-default ante fallo**
Existe una prueba que simula la indisponibilidad del servicio de resolución y verifica que el gateway bloquea (no permite) requests a rutas capability-gated.

**CA-10 — Subcuotas de workspace**
Existe una prueba que verifica: (a) subcuota se respeta en enforcement; (b) la suma de subcuotas no puede exceder el límite del tenant; (c) un cambio upstream que invalida la subcuota genera señalización de inconsistencia.

**CA-11 — Auditoría de enforcement**
Existe una prueba que provoca un rechazo por capability y otro por cuota, y verifica que ambos generan eventos de auditoría con los campos obligatorios.

**CA-12 — Ortogonalidad capability-cuota**
Existe una prueba que verifica EC-02 (capability habilitada + cuota en 0): el gateway permite la ruta pero bloquea la creación del recurso por cuota, con errores distintos y no contradictorios.

**CA-13 — Suite ejecutable en CI**
La suite completa se ejecuta en un pipeline de CI sin intervención manual y produce un reporte estructurado de resultados.

**CA-14 — Aislamiento multi-tenant en pruebas**
Existe una prueba que crea dos tenants con planes diferentes y verifica que el enforcement de cada uno es independiente: las capabilities y cuotas de un tenant no afectan al otro.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|----|-------------|--------------|---------|---------------------|
| R-01 | Entorno de pruebas inestable o incompleto impide ejecución de la suite | Media | Alto | Definir requisitos mínimos del entorno (servicios desplegados, datos seed) como precondición documentada. Incluir health-check previo en la suite. |
| R-02 | TTL de propagación variable causa flakiness en pruebas de coherencia temporal | Alta | Medio | Usar waits configurables con polling + timeout en lugar de sleeps fijos. Documentar el TTL máximo aceptable como parámetro de la suite. |
| R-03 | Pruebas de consola requieren automatización de browser (Playwright/Cypress) que añade complejidad | Media | Medio | Diferenciar entre pruebas de API (más estables, prioritarias) y pruebas de consola (E2E con browser, separables en un pipeline distinto). |
| R-04 | Limpieza incompleta del teardown deja estado residual que afecta ejecuciones posteriores | Media | Medio | Usar identificadores únicos por ejecución (UUID/timestamp en nombres de tenant). Implementar cleanup robusto con retries. |
| R-05 | Pruebas de deny-by-default requieren capacidad de simular fallos de infraestructura | Media | Medio | Documentar el mecanismo de inyección de fallos (chaos testing, mock del servicio de resolución, feature flag) como precondición. |

### 7.2 Supuestos

**S-01**: Todos los subsistemas de T01 a T05 están implementados y desplegados en el entorno de pruebas antes de ejecutar esta suite.

**S-02**: Existe un mecanismo para crear tenants, planes y overrides de prueba de forma programática (API de superadmin documentada en specs 097–103).

**S-03**: El TTL de propagación de cambios en el gateway es configurable y conocido, de modo que las pruebas pueden esperar el tiempo adecuado.

**S-04**: La consola expone un API o interfaz testeable (endpoints JSON que alimentan la UI, o la UI es automatizable con Playwright/Cypress).

**S-05**: Existe un mecanismo de inyección de fallos o feature flag que permite simular la indisponibilidad del servicio de resolución para las pruebas de deny-by-default (R-05).

**S-06**: Las pruebas tienen acceso a las credenciales necesarias (superadmin, tenant owner) a través de variables de entorno o secretos de CI, no hardcodeadas.

### 7.3 Preguntas abiertas

**P-01 — ¿Cuál es el TTL máximo aceptable que las pruebas deben tolerar para la propagación?**
Las pruebas de coherencia temporal (CA-05, CA-06, CA-07, CA-08) necesitan saber cuánto esperar antes de declarar fallo. ¿Es 5 minutos? ¿30 segundos? Esto afecta directamente al timeout de las pruebas y al tiempo total de la suite.
*Bloquea*: configuración de timeouts y time budget de la suite.

**P-02 — ¿Las pruebas de consola deben ser E2E con browser real o basta con verificar los endpoints JSON que alimentan la UI?**
Pruebas de API backend de consola son más estables y rápidas. Pruebas E2E con browser cubren más (rendering, estado de componentes) pero son más frágiles. ¿Se requieren ambos niveles?
*Bloquea*: alcance de la automatización y tooling necesario (Playwright vs solo HTTP requests).

**P-03 — ¿Existe ya un framework de pruebas de integración en el proyecto o se debe definir uno nuevo?**
Si ya existe un framework (Jest, Vitest, Playwright, etc.) con helpers para crear tenants y autenticarse, la suite debería adoptarlo. Si no, la definición del framework es parte del alcance de esta tarea.
*Bloquea*: elección de tooling y estructura de la suite.

**P-04 — ¿Cómo se simula la indisponibilidad del servicio de resolución para las pruebas de deny-by-default?**
¿Se usa un feature flag? ¿Se detiene el servicio? ¿Se inyecta latencia/error via service mesh? El mecanismo afecta a la reproducibilidad de la prueba.
*Bloquea*: implementación de EC-07 y CA-09.

---

*Documento generado para el stage `speckit.specify` — US-PLAN-02-T06 | Rama: `108-plan-enforcement-tests`*
