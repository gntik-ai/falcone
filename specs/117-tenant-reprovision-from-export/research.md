# Research — US-BKP-02-T03: Reaprovisionamiento de tenant desde export

## 1) Modelo de ejecución del reaprovisionamiento

- **Decision**: Implementar el reaprovisionamiento como una OpenWhisk action síncrona que orquesta el proceso y devuelve el resultado detallado por dominio en una sola respuesta.
- **Rationale**: La spec no exige un modelo de job/poll; el stack actual ya usa acciones síncronas para exportación/validación. Mantenerlo síncrono reduce complejidad de estado, UI y contrato, y permite devolver un plan legible para dry-run.
- **Alternatives considered**: Modelo asíncrono con job store y polling; rechazado porque añade infraestructura y UX adicionales sin un requisito explícito de larga duración.

## 2) Concurrencia por tenant

- **Decision**: Añadir una tabla PostgreSQL de lock de reaprovisionamiento por `tenant_id` con `lock_token`, `expires_at` y `status`.
- **Rationale**: La spec exige rechazo `409` para reaprovisionamientos concurrentes y liberación por timeout configurable. Una tabla persistente permite visibilidad operativa, expiración controlada y recuperación tras fallos de ejecución.
- **Alternatives considered**: Advisory locks de PostgreSQL; rechazados porque no dan expiración visible ni facilitan auditoría del bloqueo.

## 3) Sustitución de identificadores

- **Decision**: Aplicar el mapa de identificadores con recorrido recursivo del artefacto, reemplazo token-aware y ordenado por longitud descendente, con validación post-transformación.
- **Rationale**: La spec prohíbe un `replaceAll` ingenuo por riesgo de reemplazos parciales. El orden por longitud y la validación posterior minimizan colisiones de subcadenas y preservan el contenido no relacionado con identificadores.
- **Alternatives considered**: Reemplazo global de texto plano; rechazado por riesgo de corrupción del artefacto. Reescritura específica por cada dominio; rechazada porque la spec pide sustitución transversal antes de los aplicadores.

## 4) Política de conflictos y secretos

- **Decision**: Mantener una política conservadora: recursos equivalentes se marcan como `skipped`, recursos diferentes como `conflict`, y valores redactados como `***REDACTED***` no se aplican; el recurso queda como `applied_with_warnings`.
- **Rationale**: La spec explícitamente prohíbe la sobrescritura automática y exige visibilidad de secretos faltantes. Esta política evita cambios destructivos y mantiene trazabilidad clara para el operador.
- **Alternatives considered**: Flag `force` para sobrescribir; rechazado por riesgo de seguridad y por no estar en el alcance. Merge automático de conflictos; rechazado por ambigüedad semántica entre subsistemas.

## 5) Observabilidad y auditoría

- **Decision**: Reutilizar el patrón existente de auditoría a Kafka + tabla PostgreSQL de metadata, sin almacenar el artefacto completo en persistencia.
- **Rationale**: La spec exige auditoría de cada invocación y el proyecto ya tiene patrones de eventos fire-and-forget. Persistir solo metadata, hashes y resultados minimiza riesgo de exposición de configuración sensible y evita duplicación del artefacto.
- **Alternatives considered**: Guardar el artefacto en DB o bucket interno; rechazado porque la spec indica que el artefacto se procesa en memoria y no se almacena.

## 6) UX de revisión manual

- **Decision**: Añadir una página de consola para cargar el artefacto, revisar el mapa propuesto, editar overrides y lanzar dry-run o aplicación efectiva.
- **Rationale**: La historia requiere ajuste manual de identificadores antes de confirmar la aplicación. La consola existente para backup/export es el lugar natural para ese flujo; además, permite validar permisos y mostrar el estado por dominio de forma consistente.
- **Alternatives considered**: Exponer solo API pública y dejar el ajuste al cliente externo; rechazado porque no cubre el flujo guiado que describe la spec y complica la adopción operativa.
