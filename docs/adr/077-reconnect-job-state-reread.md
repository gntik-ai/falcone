# ADR 077 — Reconciliación de estado al reconectar la consola

## Contexto

Tras T01–T04, la consola ya podía consultar operaciones asíncronas y reaccionar ante estados terminales, pero no definía un comportamiento explícito cuando el operador recuperaba conectividad o regresaba a una pestaña abierta con jobs en curso.

## Decisiones

### 1. Re-fetch al reconectar en lugar de WebSocket/SSE

En esta fase usamos una estrategia pull disparada por eventos `online` y `visibilitychange`. Evitamos introducir la complejidad operativa de una conexión push persistente para un caso que puede resolverse con una relectura acotada del backend.

### 2. Reconciliación frontend-only

No se añade un endpoint de diff. Reutilizamos `GET /v1/async-operation-query` y concentramos la lógica de comparación en `reconcileOperations`, una utilidad pura en frontend.

### 3. Banner consolidado

Los cambios acumulados durante la desconexión se presentan en un único banner resumido. Esto reduce ruido visual y evita un aluvión de notificaciones individuales.

### 4. Estado efímero en memoria

No persistimos snapshots de operaciones en `localStorage` ni `sessionStorage`. El backend sigue siendo la fuente de verdad y el estado local es desechable.

### 5. Feature flag

El comportamiento automático queda protegido por `CONSOLE_RECONNECT_SYNC_ENABLED` / `VITE_CONSOLE_RECONNECT_SYNC_ENABLED` con valor efectivo por defecto `true`, de forma que pueda deshabilitarse rápidamente durante incidencias.

## Consecuencias

- No hay cambios en backend ni en el schema introducido por T01–T04.
- El frontend asume la complejidad de reconciliación y UX post-reconexión.
- Si el flag está apagado o el backend no responde, la consola degrada de forma segura sin sincronización automática.
