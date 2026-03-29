# Spec — UX Regression Tests for Wizards, Confirmations and Snippets

**Feature slug**: `066-ux-regression-tests-wizards-confirmations-snippets`
**Task ID**: US-UI-04-T06
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**RF cubiertos**: RF-UI-025, RF-UI-026, RF-UI-027, RF-UI-028, RF-UI-029, RF-UI-030
**Dependencias**: US-OBS-03, US-UI-03, US-UI-04-T01, US-UI-04-T02, US-UI-04-T03, US-UI-04-T04, US-UI-04-T05
**Fecha**: 2026-03-29
**Estado**: Draft

---

## 1. Objetivo y problema que resuelve

Las tareas T02 (wizards de onboarding), T03 (salvaguardas destructivas) y T05 (snippets de conexión) introducen flujos de interacción complejos y multi-paso en la consola BaaS multi-tenant. Estos flujos involucran navegación entre pasos, validaciones progresivas, diálogos modales con confirmación reforzada, copiar al portapapeles y generación dinámica de contenido contextualizado. Cada uno de estos comportamientos es susceptible a regresiones cuando se modifica cualquier componente compartido (design system, selector de contexto, permisos, APIs de backend).

Sin una suite de **pruebas de regresión de UX** dedicada, los cambios en componentes compartidos o en la lógica de negocio pueden romper silenciosamente:

- La navegación multi-paso de los wizards (avance, retroceso, resumen).
- La validación progresiva y el bloqueo de avance en wizards.
- El funcionamiento de los diálogos destructivos (type-to-confirm, resumen de impacto en cascada, foco por defecto).
- La generación contextualizada de snippets y la funcionalidad de copiar al portapapeles.
- La coherencia visual entre los diferentes diálogos y secciones.

Esta tarea especifica la **suite de pruebas de regresión de UX** que verifica de forma automatizada los comportamientos de aceptación de estas tres capacidades, proporcionando una red de seguridad contra regresiones y un gate de calidad ejecutable en CI.

## 2. Usuarios afectados y valor recibido

| Actor | Valor |
|---|---|
| **Equipo de desarrollo** | Detecta regresiones de UX de forma automática antes de que lleguen a producción. Reduce el coste de validación manual en cada cambio. |
| **QA / Equipo de calidad** | Dispone de una suite ejecutable y mantenible que cubre los escenarios de aceptación de wizards, confirmaciones y snippets. Libera tiempo para testing exploratorio. |
| **Product Owner** | Tiene garantía de que los criterios de aceptación de T02, T03 y T05 se verifican de forma continua, no solo al momento de la entrega. |
| **Tenant Owner / Workspace Admin / Developer** | Reciben una consola cuyo comportamiento de onboarding, protección y ayuda de conexión es estable y predecible entre releases. |

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Alcance de regresión: Wizards (T02)

Los tests cubren los seis wizards de onboarding (W1–W6) en los siguientes escenarios:

| ID | Escenario | Comportamiento esperado |
|---|---|---|
| RW-01 | Navegación completa adelante/atrás en cada wizard | El usuario puede avanzar y retroceder entre todos los pasos; los datos introducidos se preservan al retroceder. |
| RW-02 | Bloqueo de avance por validación | Con datos inválidos en un paso, el botón "Siguiente" permanece deshabilitado y se muestran mensajes de error inline. |
| RW-03 | Paso de resumen muestra todos los valores | El paso final de cada wizard presenta un resumen read-only de todos los valores introducidos en los pasos previos. |
| RW-04 | Navegación desde resumen a paso anterior | Desde el paso de resumen, el usuario puede volver a cualquier paso anterior y los datos se preservan. |
| RW-05 | Confirmación exitosa muestra feedback y enlace | Tras completar el wizard, se muestra confirmación de éxito con enlace funcional al recurso creado. |
| RW-06 | Error de backend en confirmación preserva datos | Si la creación falla, el wizard muestra el error del backend sin perder los datos del formulario. |
| RW-07 | Cuota excedida bloquea avance | Con cuota al límite, el wizard bloquea el paso relevante y muestra aviso inline. |
| RW-08 | Sin permisos, el wizard no se abre | Un usuario sin el permiso requerido no puede acceder al wizard; se muestra mensaje de permisos insuficientes. |

### 3.2 Alcance de regresión: Confirmaciones destructivas (T03)

Los tests cubren los diálogos CRITICAL y WARNING en los siguientes escenarios:

| ID | Escenario | Comportamiento esperado |
|---|---|---|
| RC-01 | Diálogo CRITICAL muestra campo type-to-confirm | Al iniciar eliminación de tenant, workspace, base de datos o revocación masiva de API keys, se muestra diálogo con input de confirmación. |
| RC-02 | Botón de confirmación CRITICAL deshabilitado hasta coincidencia exacta | El botón solo se habilita cuando el texto introducido coincide exactamente (case-sensitive) con el nombre del recurso. |
| RC-03 | Resumen de impacto en cascada presente en diálogos CRITICAL | El diálogo muestra tipos y cantidades de recursos dependientes. |
| RC-04 | Diálogo WARNING muestra botones Cancelar/Eliminar sin type-to-confirm | Para operaciones de nivel WARNING, el diálogo presenta dos botones sin campo de texto. |
| RC-05 | Foco por defecto en botón Cancelar | Al abrir cualquier diálogo destructivo, el foco del teclado está en "Cancelar". |
| RC-06 | Escape cierra el diálogo sin ejecutar | La tecla Escape y el click fuera del modal cierran el diálogo; la operación no se ejecuta. |
| RC-07 | Confirmación exitosa muestra feedback y redirige | Tras confirmación exitosa, se muestra mensaje de éxito y se redirige al listado padre. |
| RC-08 | Error de backend muestra mensaje sin cerrar diálogo | Si la eliminación falla, el diálogo permanece abierto con el mensaje de error visible. |
| RC-09 | Diálogo degradado cuando API de impacto falla | Si no se puede obtener el resumen de cascada, el diálogo muestra aviso genérico y permite confirmar. |
| RC-10 | Un solo diálogo abierto a la vez | No es posible abrir dos diálogos destructivos simultáneamente. |

### 3.3 Alcance de regresión: Snippets de conexión (T05)

Los tests cubren la generación y presentación de snippets en los siguientes escenarios:

| ID | Escenario | Comportamiento esperado |
|---|---|---|
| RS-01 | Sección de snippets presente en detalle de recurso soportado | La vista de detalle de PostgreSQL, MongoDB, storage bucket, función y client IAM muestra la sección "Snippets de conexión". |
| RS-02 | Snippets contextualizados con valores del recurso activo | Los valores de host, puerto, nombre, tenant y workspace en el snippet coinciden con el contexto activo. |
| RS-03 | Secretos sustituidos por placeholders | Ningún snippet muestra credenciales reales; todos los secretos aparecen como placeholders descriptivos con referencia a la sección correspondiente. |
| RS-04 | Botón copiar funciona y muestra feedback | El botón "Copiar" copia el contenido al portapapeles y muestra confirmación visual transitoria. |
| RS-05 | Recurso sin endpoint muestra placeholders y nota | Si el recurso no tiene endpoint asignado, los snippets usan placeholders genéricos con nota explicativa. |
| RS-06 | Recurso en estado transitorio muestra advertencia | Si el recurso está en aprovisionamiento o error, los snippets se generan con nota de advertencia visible. |
| RS-07 | Sin snippets para tipo no soportado, sección oculta | Para un tipo de recurso sin snippets definidos, la sección no se renderiza. |
| RS-08 | Cobertura mínima de lenguajes/herramientas | Cada tipo de recurso presenta al menos los snippets definidos en la tabla 3.4 de la spec T05. |

### 3.4 Reglas de negocio transversales para la suite

1. **Aislamiento de tests**: cada test debe poder ejecutarse de forma independiente sin depender del estado dejado por otro test. Los datos de prueba se configuran al inicio y se limpian al final de cada caso.
2. **Mocking de backend**: los tests de regresión de UX interactúan con la interfaz de la consola, no con el backend real. Las respuestas de API se mockan para garantizar determinismo y velocidad.
3. **Datos de prueba representativos**: los fixtures incluyen al menos un tenant con múltiples workspaces, recursos de cada tipo (PG, Mongo, storage, función, client IAM), y configuraciones de permisos y cuotas diferenciadas.
4. **Ejecución en CI**: la suite debe ser ejecutable desde el script raíz del monorepo y producir un informe de resultados compatible con el pipeline de CI existente.
5. **Naming convention**: cada test se identifica con el prefijo de su grupo (`RW-`, `RC-`, `RS-`) seguido de un número secuencial, alineado con los IDs de esta spec.
6. **Trazabilidad con criterios de aceptación**: cada test referencia explícitamente los criterios de aceptación de las specs T02, T03 o T05 que cubre.
7. **Sin lógica de negocio duplicada**: los tests validan el comportamiento visible de la UI, no reimplementan la lógica interna de validación o generación de snippets.

### 3.5 Edge cases

| Caso | Comportamiento esperado del test |
|---|---|
| Componente compartido modificado (e.g., dialog base) | Los tests de RC y RW detectan regresión en foco, layout o interacción de los diálogos derivados. |
| Nuevo wizard añadido (W7+) | La suite existente no se rompe; el nuevo wizard requiere añadir tests adicionales. |
| Nuevo tipo de recurso sin snippets | RS-07 verifica que la sección no se renderiza; no se genera falso positivo. |
| Cambio de API de permisos | RW-08 y los tests que verifican bloqueo por permisos detectan la regresión. |
| Cambio en respuesta de API de cuotas | RW-07 detecta la regresión en el bloqueo por cuota. |

## 4. Requisitos funcionales verificables

| ID | Requisito | Verificación |
|---|---|---|
| RF-RT-01 | La suite incluye al menos los 8 escenarios de regresión de wizards (RW-01 a RW-08) como tests ejecutables. | Listar tests de la suite; verificar presencia de cada ID. |
| RF-RT-02 | La suite incluye al menos los 10 escenarios de regresión de confirmaciones destructivas (RC-01 a RC-10) como tests ejecutables. | Listar tests de la suite; verificar presencia de cada ID. |
| RF-RT-03 | La suite incluye al menos los 8 escenarios de regresión de snippets (RS-01 a RS-08) como tests ejecutables. | Listar tests de la suite; verificar presencia de cada ID. |
| RF-RT-04 | Cada test es independiente y ejecutable en aislamiento, sin depender del estado dejado por otro test. | Ejecutar tests individuales en orden aleatorio; verificar que pasan. |
| RF-RT-05 | Las respuestas de backend están mockeadas; los tests no requieren un backend real en ejecución. | Ejecutar la suite sin backend; verificar que completa sin errores de conexión. |
| RF-RT-06 | Los fixtures de datos incluyen al menos un tenant con múltiples workspaces, recursos de cada tipo soportado, y configuraciones de permisos y cuotas diferenciadas. | Inspeccionar fixtures; verificar cobertura de escenarios. |
| RF-RT-07 | La suite se ejecuta desde el script raíz del monorepo y produce un informe de resultados (exit code + reporte). | Ejecutar desde raíz; verificar exit code y reporte generado. |
| RF-RT-08 | Cada test documenta en su descripción o nombre la referencia al criterio de aceptación de T02, T03 o T05 que cubre. | Inspeccionar nombres/descripciones de tests; verificar trazabilidad. |
| RF-RT-09 | La suite ejecuta en menos de 5 minutos en un entorno de CI estándar (sin backend, con mocks). | Medir tiempo de ejecución en CI; verificar umbral. |
| RF-RT-10 | Añadir un nuevo test a la suite no requiere modificar tests existentes ni la infraestructura de ejecución. | Añadir un test dummy; verificar que la suite existente sigue pasando sin cambios. |

### Límites de alcance

- **Incluido**: tests de regresión de UX automatizados para los escenarios de aceptación de wizards (T02), confirmaciones destructivas (T03) y snippets (T05). Fixtures de datos mockeados. Ejecución integrada en CI.
- **Excluido**: tests end-to-end contra backend real (requieren entorno de integración completo; fuera de alcance de esta tarea).
- **Excluido**: tests de rendimiento o carga de la consola.
- **Excluido**: tests de las vistas de métricas, auditoría, API keys y cuotas (→ T01).
- **Excluido**: tests de logs de ejecución de funciones (→ T04).
- **Excluido**: tests de accesibilidad exhaustivos (a11y). Los tests verifican foco y teclado como parte de los escenarios funcionales, pero no constituyen una auditoría de accesibilidad completa.
- **Excluido**: tests de otros dominios funcionales fuera de US-UI-04.

## 5. Permisos, multi-tenancy, auditoría, cuotas y seguridad

### Permisos

- Los tests verifican que los componentes de UI respetan la presencia o ausencia de permisos en el contexto mockeado.
- Escenarios cubiertos: usuario con permisos completos (happy path), usuario sin permiso para la operación (bloqueo esperado), usuario con permisos parciales (acceso a algunos wizards pero no a todos).

### Multi-tenancy

- Los fixtures de tests modelan al menos dos tenants con datos separados para verificar que:
  - Los snippets contextualizan al tenant/workspace activo.
  - Los diálogos de impacto en cascada solo muestran recursos del tenant activo.
  - Los wizards operan dentro del contexto de tenant/workspace seleccionado.

### Auditoría

- Los tests no verifican la generación de eventos de auditoría (eso es responsabilidad del backend). Los tests verifican que la UI invoca la acción de backend correctamente; la generación del evento es una responsabilidad server-side fuera de alcance.

### Cuotas

- Los tests verifican el comportamiento de la UI ante respuestas de cuota mockeadas:
  - Cuota disponible → wizard avanza.
  - Cuota excedida → wizard bloquea el paso con aviso.

### Seguridad

- Los tests verifican que los snippets no exponen secretos (validan presencia de placeholders en lugar de valores reales).
- Los fixtures no contienen credenciales reales; todos los datos de test son ficticios.
- Los tests no realizan llamadas de red reales.

## 6. Criterios de aceptación

1. La suite contiene al menos 26 tests ejecutables (8 RW + 10 RC + 8 RS) que cubren los escenarios especificados en la sección 3.
2. Cada test es independiente y puede ejecutarse en aislamiento sin depender de otros tests.
3. Todas las interacciones de backend están mockeadas; la suite ejecuta sin necesidad de backend real.
4. Los fixtures modelan al menos un tenant con múltiples workspaces, recursos de todos los tipos soportados, y configuraciones diferenciadas de permisos y cuotas.
5. La suite se invoca desde el script raíz del monorepo y produce un reporte de resultados con exit code.
6. Cada test documenta la trazabilidad con el criterio de aceptación de T02, T03 o T05 que verifica.
7. El tiempo de ejecución de la suite completa es inferior a 5 minutos en CI con mocks.
8. Añadir nuevos tests a la suite no requiere modificar tests existentes ni la infraestructura de ejecución.
9. Los tests de snippets validan que ningún snippet expone credenciales reales (verifican presencia de placeholders).
10. Los tests de multi-tenancy verifican que los datos presentados en UI corresponden exclusivamente al contexto activo.

## 7. Riesgos, supuestos y preguntas abiertas

### Supuestos

- Las implementaciones de T02 (wizards), T03 (confirmaciones destructivas) y T05 (snippets) están disponibles o se implementan antes o en paralelo a esta tarea; los tests se escriben contra los componentes entregados por esas tareas.
- El monorepo tiene configurada una herramienta de testing de componentes o end-to-end de UI (e.g., Vitest + Testing Library, Playwright, o Cypress) que soporta mocking de API y rendering de componentes React.
- El pipeline de CI soporta la ejecución de la suite y la generación de reportes.
- Los componentes de UI de las tareas T02, T03 y T05 exponen una estructura DOM estable y testeable (data-testid, roles ARIA, o selectores semánticos consistentes).

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Las tareas T02, T03 o T05 no están implementadas cuando se inicia T06. | Diseñar los tests contra las specs publicadas (contratos de comportamiento); usar stubs de componentes si es necesario. Priorizar tests que verifiquen el contrato, no la implementación interna. |
| La herramienta de testing no está configurada en el monorepo. | El plan de implementación de T06 debe incluir la configuración de la infraestructura de testing como primer paso si no existe. |
| Los componentes no exponen selectores estables (data-testid). | Coordinar con las tareas T02, T03 y T05 para que los componentes incluyan atributos de testabilidad. Documentar la convención de data-testid en la guía de desarrollo. |
| Los mocks de API quedan desincronizados con las APIs reales. | Los mocks se derivan de los contratos de API documentados en las specs. Añadir un test de contrato básico que valide la estructura del mock contra un schema si está disponible. |

### Preguntas abiertas

- Ninguna bloqueante identificada para avanzar a planificación.
