<!-- markdownlint-disable MD031 MD040 -->
# Plan técnico de implementación — US-SEC-02-T04

**Feature Branch**: `094-admin-data-privilege-separation`
**Task ID**: US-SEC-02-T04
**Epic**: EP-18 — Seguridad funcional transversal
**Historia padre**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios
**Fecha del plan**: 2026-03-31
**Estado**: Ready for tasks
**Dependencias directas**: US-SEC-02-T01 (`091-secure-secret-storage`), US-SEC-02-T02 (`092-secret-rotation-no-redeploy`), US-SEC-02-T03 (`093-scope-enforcement-blocking`)
**Requisitos funcionales**: RF-SEC-010, RF-SEC-011

---

## 1. Objetivo y alcance estricto de T04

Implementar la **separación de permisos entre administración estructural y acceso a datos** en la plataforma BaaS multi-tenant, incluyendo:

- Clasificación exhaustiva de todos los permisos de la plataforma en exactamente dos dominios de privilegio: **`structural_admin`** (ciclo de vida de recursos, configuración, esquemas, despliegue) y **`data_access`** (lectura, escritura, consulta y borrado de datos de aplicación del tenant).
- Extensión del plugin APISIX `scope-enforcement` existente (T03) para evaluar el dominio de privilegio requerido por endpoint antes de enrutar al backend.
- Nuevo tipo de entidad **Privilege Domain Assignment** para workspace members, gestionado en PostgreSQL y sincronizado en Keycloak.
- Restricción en la API de creación de API keys (089-api-key-rotation) para requerir exactamente un dominio de privilegio por key; migración de keys existentes.
- Guard-rail: prevención de eliminar al último structural-admin de un workspace.
- Propagación de cambios a sesiones activas en ≤ 60 segundos vía Keycloak token introspection o invalidación de caché en APISIX.
- Registro de eventos de auditoría de denegaciones cross-domain en Kafka y PostgreSQL (tabla nueva `privilege_domain_denials`).
- Extensión de la consola React (`ConsolePrivilegeDomainPage.tsx`) para que tenant owners gestionen las asignaciones de dominio por miembro.
- Vista de auditoría para superadmins con filtro por dominio.

### Fuera de alcance de T04

- Almacenamiento seguro de secretos (T01), rotación de secretos (T02), enforcement de scopes (T03).
- Separación deploy vs. ejecución de funciones (T05).
- Pruebas de hardening (T06).
- Control de acceso por campo o fila dentro de una colección (documentado como extensión futura).
- Creación de un tercer dominio de privilegio (p. ej. "observabilidad").

---

## 2. Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces); Lua 5.1 (extensión plugin APISIX / OpenResty)
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka audit), Apache OpenWhisk action patterns (`services/provisioning-orchestrator/src/actions/`), React 18 + Tailwind CSS + shadcn/ui (consola), APISIX plugin API (`kong.request`, `ngx` globals, shared dict)
**Storage**: PostgreSQL (`privilege_domain_assignments`, `privilege_domain_denials`, extensión de `api_keys`, extensión de `endpoint_scope_requirements`); cache in-memory APISIX (LRU TTL configurable)
**Testing**: `node:test` Node 20 built-in (backend unit/integración); Vitest + React Testing Library (consola); Lua `busted` (plugin unitario); `pg_prove` o migration smoke tests (migraciones SQL)
**Target Platform**: Kubernetes / OpenShift (Helm), multi-tenant BaaS
**Project Type**: Multi-service monorepo (control-plane + gateway-config + provisioning-orchestrator + web-console)
**Performance Goals**: evaluación de dominio de privilegio p95 < 3 ms (caché in-process APISIX); propagación de cambios de dominio ≤ 60 s; query de denegaciones < 300 ms por 30 días
**Constraints**: multi-tenancy estricto, workspace isolation, fail-closed por defecto, sin secretos en repositorio, mínimo 1 structural-admin por workspace en todo momento
**Scale/Scope**: todos los endpoints públicos `/v1/`; todos los workspace members; migración de todas las API keys existentes

---

## 3. Constitution Check

| Principio | Estado | Notas |
|-----------|--------|-------|
| I. Monorepo Separation of Concerns | ✅ PASS | Extensión del plugin Lua en `services/gateway-config/plugins/scope-enforcement.lua`; nuevas acciones OpenWhisk en `services/provisioning-orchestrator/src/actions/`; migración SQL en `services/provisioning-orchestrator/src/migrations/`; nuevas páginas React en `apps/web-console/src/pages/`; contratos en `services/internal-contracts/src/`. Sin nuevas carpetas de primer nivel. |
| II. Incremental Delivery First | ✅ PASS | Fases ordenadas: modelo de datos → plugin (extensión puntual) → acciones query/assign → migración de API keys → UI. Cada fase independientemente revisable. |
| III. Kubernetes / OpenShift Compatibility | ✅ PASS | Plugin empaquetado en ConfigMap existente; migraciones via Helm job; sin supuestos de host. |
| IV. Quality Gates at Root | ✅ PASS | Tests nuevos integrados en scripts raíz existentes (`node --test`, Vitest, `busted`). |
| V. Documentation as Part of the Change | ✅ PASS | Este plan.md + data-model.md + contracts/ + ADR en `docs/adr/` dentro del mismo cambio. |
| Secrets | ✅ PASS | Sin valores de secretos en repositorio. Tokens Keycloak gestionados en runtime. |
| pnpm workspaces | ✅ PASS | Nuevos artefactos siguen el patrón de workspace members existente. |

*Sin violaciones. Tabla de complejidad no requerida.*

---

## 4. Arquitectura objetivo

### 4.1 Modelo conceptual de dominios de privilegio

```
Plataforma
├── Dominio: structural_admin
│   Permisos incluidos:
│   ├── tenant:create / tenant:update / tenant:delete
│   ├── workspace:create / workspace:update / workspace:delete / workspace:settings:write
│   ├── schema:create / schema:update / schema:drop (MongoDB collections, PostgreSQL DDL)
│   ├── service:configure (Kafka, storage buckets, OpenWhisk namespaces)
│   ├── function:deploy / function:delete / function:version:manage
│   ├── member:invite / member:remove / member:role:assign
│   ├── api-key:create / api-key:revoke
│   └── quota:manage / plan:assign
│
└── Dominio: data_access
    Permisos incluidos:
    ├── document:read / document:write / document:delete / document:query
    ├── object:read / object:write / object:delete (S3-compatible)
    ├── function:invoke
    ├── analytics:query
    └── event:publish / event:subscribe (tenant application events)
```

**Regla fundamental**: ningún permiso puede pertenecer a ambos dominios. Los superadmins de plataforma (`platform_admin`) tienen bypass explícito evaluado *antes* de la comprobación de dominio, no mezclando los dominios.

### 4.2 Diagrama de componentes

```
Cliente (user session / API key / service account)
  │
  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ APISIX (services/gateway-config/)                                      │
│                                                                        │
│  Fase: access                                                          │
│                                                                        │
│  Plugin 1: key-auth / jwt-auth  ← extrae claims del token              │
│  Plugin 2: scope-enforcement    ← EXTENSIÓN T04                        │
│    ├─ (existente T03) valida scopes y plan entitlements                │
│    ├─ (nuevo T04) extrae privilege_domain del token/API key claim      │
│    ├─ Consulta endpoint_privilege_domain_requirement en caché          │
│    ├─ Si credencial.domain ≠ endpoint.required_domain                  │
│    │     → DENY PRIVILEGE_DOMAIN_MISMATCH                              │
│    │     → emit Kafka console.security.privilege-domain-denied         │
│    │     → HTTP 403                                                    │
│    ├─ Si plataforma admin (role=platform_admin) → bypass               │
│    └─ Inyecta X-Privilege-Domain: {structural_admin|data_access}       │
│                                                                        │
│  Manifiestos: plugins/scope-enforcement.lua (modificado)               │
│               routes/ (nuevas rutas de gestión de dominio)             │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ peticiones permitidas
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ provisioning-orchestrator / control-plane backend                      │
│   Recibe X-Privilege-Domain header (second-line re-validation posible) │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Keycloak                                                               │
│   ├── Realm roles: structural_admin_<workspaceId>, data_access_<workspaceId> │
│   ├── Composite roles por workspace                                    │
│   └── Claim inyectado en JWT: "privilege_domain": "structural_admin"   │
│       (mapper configurado por workspace)                               │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Kafka Topics                                                           │
│   console.security.privilege-domain-denied   (30d)                    │
│   console.security.privilege-domain-assigned (30d)                    │
│   console.security.privilege-domain-revoked  (30d)                    │
│   console.security.last-admin-guard-triggered (30d)                   │
└───────────────────────────┬────────────────────────────────────────────┘
                            │ consume
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ privilege-domain-event-recorder (OpenWhisk action)                     │
│   → INSERT privilege_domain_denials (PostgreSQL)                       │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ privilege-domain-audit-query (OpenWhisk action)                        │
│   → GET /api/security/privilege-domains/denials                        │
│   → filtra por tenant, workspace, privilege_domain, actor, time range  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ privilege-domain-assign (OpenWhisk action)                             │
│   → POST /api/workspaces/:workspaceId/members/:memberId/privilege-domains │
│   → Valida last-admin guard                                            │
│   → Actualiza privilege_domain_assignments en PostgreSQL               │
│   → Sincroniza roles en Keycloak                                       │
│   → Invalida caché APISIX via APISIX admin API                        │
│   → Emite eventos Kafka                                                │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ api-key-domain-migration (OpenWhisk action — one-shot)                 │
│   → Clasifica API keys existentes sin privilege_domain                 │
│   → Asigna dominio por histórico de uso o flag para revisión           │
│   → Respeta APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS                 │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ apps/web-console/src/pages/ConsolePrivilegeDomainPage.tsx              │
│   → Vista de asignación de dominio por miembro (tenant owner)          │
│   → Dos secciones separadas: Structural / Data Access                  │
│   → Guard UI: último structural-admin no puede ser degradado           │
│   → Vista de denegaciones recientes para superadmin                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Decisiones de arquitectura

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| Representación del dominio en JWT | Claim `privilege_domain` inyectado vía Keycloak protocol mapper | Keycloak es la fuente de verdad; el claim evita roundtrip adicional en el gateway |
| Representación en API keys | Columna `privilege_domain` NOT NULL ENUM en tabla `api_keys` | Atributo inmutable tras creación; forzado por constraint de base de datos |
| Extensión vs. nuevo plugin APISIX | Extender `scope-enforcement.lua` existente (T03) | Evita duplicar lógica de extracción de claims y gestión de caché; un solo punto de enforcement en el gateway |
| Propagación de cambios | Keycloak session invalidation (logout forced) + invalidación caché APISIX admin API en la acción de asignación | Garantiza ≤ 60 s de propagación sin polling activo |
| Last-admin guard | Enforced en la acción `privilege-domain-assign` con SELECT FOR UPDATE sobre el contador de structural_admins por workspace | Atómica; previene race condition entre asignaciones concurrentes |
| Clasificación de API keys históricas | Heurística por `last_used_endpoint_category` (structural vs. data); fallback a flag `requires_owner_review` | Conservadora: claves ambiguas no reciben dominio automático; se notifica al owner |
| Formato de los Keycloak roles | `structural_admin_{workspaceId}` y `data_access_{workspaceId}` como realm roles + composite role por workspace | Aísla por workspace; compatible con federación de IdP externo |
| Cache invalidation en APISIX | APISIX Admin API `DELETE /apisix/admin/plugin_metadata/scope-enforcement` + dict flush de `privilege_domain_cache` | Consistente con patrón ya usado en T03 para `scope_plan_cache` |

### 4.4 Flujo de evaluación del dominio (secuencia)

```
Cliente → APISIX
  │
  ├─1─► Plugin key-auth / jwt-auth verifica token / API key
  │       Si inválido/expirado → HTTP 401 (antes del dominio check)
  │
  ├─2─► Plugin scope-enforcement extrae:
  │       scopes, workspace_id, tenant_id, plan_id  (existente T03)
  │       privilege_domain del claim JWT o columna api_keys.privilege_domain
  │
  ├─3─► [NUEVO T04] Lookup endpoint_privilege_domain_requirement (caché LRU):
  │       Endpoint clasificado como "structural_admin" o "data_access"
  │       Sin clasificación → DENY CONFIG_ERROR + HTTP 403
  │
  ├─4─► [NUEVO T04] Si actor.role == "platform_admin" → BYPASS (saltar a paso 7)
  │
  ├─5─► [NUEVO T04] credential.privilege_domain == required.privilege_domain ?
  │       Sí → continúa
  │       No → DENY PRIVILEGE_DOMAIN_MISMATCH + emit Kafka + HTTP 403
  │
  ├─6─► [EXISTENTE T03] Evaluación de scopes y plan entitlements
  │
  ├─7─► Inyecta X-Privilege-Domain: {domain} + X-Enforcement-Verified: true
  │
  └─8─► Proxy petición al backend
```

---

## 5. Modelo de datos

### 5.1 Nuevas tablas PostgreSQL

```sql
-- Migración: 094-admin-data-privilege-separation.sql

-- Asignaciones de dominio de privilegio por workspace member
CREATE TABLE IF NOT EXISTS privilege_domain_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  workspace_id        UUID NOT NULL,
  member_id           UUID NOT NULL,          -- FK a la tabla de members/users
  structural_admin    BOOLEAN NOT NULL DEFAULT false,
  data_access         BOOLEAN NOT NULL DEFAULT false,
  assigned_by         UUID NOT NULL,           -- actor que realizó el cambio
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_pda_workspace_member
  ON privilege_domain_assignments (workspace_id, member_id);

CREATE INDEX IF NOT EXISTS idx_pda_tenant_structural
  ON privilege_domain_assignments (tenant_id, workspace_id)
  WHERE structural_admin = true;

-- Vista de conteo de structural admins por workspace (para last-admin guard)
CREATE OR REPLACE VIEW workspace_structural_admin_count AS
  SELECT workspace_id, tenant_id, COUNT(*) AS structural_admin_count
  FROM privilege_domain_assignments
  WHERE structural_admin = true
  GROUP BY workspace_id, tenant_id;

-- Registro inmutable de denegaciones por dominio de privilegio
CREATE TABLE IF NOT EXISTS privilege_domain_denials (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL,
  workspace_id             UUID,
  actor_id                 TEXT NOT NULL,
  actor_type               TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','anonymous')),
  credential_domain        TEXT CHECK (credential_domain IN ('structural_admin','data_access','none')),
  required_domain          TEXT NOT NULL CHECK (required_domain IN ('structural_admin','data_access')),
  http_method              TEXT NOT NULL,
  request_path             TEXT NOT NULL,
  source_ip                INET,
  correlation_id           TEXT NOT NULL,
  denied_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pdd_tenant_denied_at
  ON privilege_domain_denials (tenant_id, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdd_workspace_denied_at
  ON privilege_domain_denials (workspace_id, denied_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pdd_required_domain
  ON privilege_domain_denials (required_domain, denied_at DESC);

-- Historial de cambios en asignaciones (audit trail inmutable)
CREATE TABLE IF NOT EXISTS privilege_domain_assignment_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id       UUID NOT NULL,
  tenant_id           UUID NOT NULL,
  workspace_id        UUID NOT NULL,
  member_id           UUID NOT NULL,
  change_type         TEXT NOT NULL CHECK (change_type IN ('assigned','revoked','migrated','system')),
  privilege_domain    TEXT NOT NULL CHECK (privilege_domain IN ('structural_admin','data_access')),
  changed_by          UUID NOT NULL,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_pdah_workspace_member
  ON privilege_domain_assignment_history (workspace_id, member_id, changed_at DESC);
```

### 5.2 Extensión de tabla existente `api_keys`

```sql
-- Añadir columna de dominio a la tabla api_keys (089-api-key-rotation)
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS privilege_domain TEXT
    CHECK (privilege_domain IN ('structural_admin','data_access','pending_classification'));

-- Las nuevas claves exigirán NOT NULL (constraint diferida para migración)
-- Después del período de gracia, upgradeamos el constraint:
-- ALTER TABLE api_keys ALTER COLUMN privilege_domain SET NOT NULL;
```

### 5.3 Extensión de tabla existente `endpoint_scope_requirements`

```sql
-- Añadir clasificación de dominio de privilegio a cada endpoint (093)
ALTER TABLE endpoint_scope_requirements
  ADD COLUMN IF NOT EXISTS privilege_domain TEXT
    CHECK (privilege_domain IN ('structural_admin','data_access'));
-- NULL = endpoint no clasificado (fail-closed: se bloquea hasta clasificar)
```

### 5.4 Clasificación inicial de endpoints

Los endpoints del catálogo público (`services/gateway-config/public-route-catalog.json`) se clasificarán en el mismo script de migración o como seed de datos separado:

```text
structural_admin:
  POST   /v1/tenants
  PUT    /v1/tenants/:id
  DELETE /v1/tenants/:id
  POST   /v1/workspaces
  PUT    /v1/workspaces/:id
  DELETE /v1/workspaces/:id
  POST   /v1/workspaces/:id/members
  DELETE /v1/workspaces/:id/members/:memberId
  POST   /v1/schemas
  PUT    /v1/schemas/:id
  DELETE /v1/schemas/:id
  POST   /v1/functions
  DELETE /v1/functions/:id
  PUT    /v1/functions/:id/config
  POST   /v1/api-keys
  DELETE /v1/api-keys/:id
  POST   /v1/services/configure
  PUT    /v1/quotas
  GET    /v1/workspaces/:id/members         (read structural metadata)
  GET    /v1/schemas                        (structural metadata read)

data_access:
  GET    /v1/collections/:name/documents
  POST   /v1/collections/:name/documents
  PUT    /v1/collections/:name/documents/:id
  DELETE /v1/collections/:name/documents/:id
  POST   /v1/collections/:name/query
  GET    /v1/objects/:bucket/:key
  PUT    /v1/objects/:bucket/:key
  DELETE /v1/objects/:bucket/:key
  POST   /v1/functions/:id/invoke
  GET    /v1/analytics/query
  POST   /v1/events/publish
  GET    /v1/events/subscribe
```

---

## 6. Contratos de API

### 6.1 GET /api/workspaces/:workspaceId/members/:memberId/privilege-domains

Respuesta:
```json
{
  "memberId": "uuid",
  "workspaceId": "uuid",
  "tenantId": "uuid",
  "structural_admin": true,
  "data_access": false,
  "assignedAt": "2026-03-31T00:00:00Z",
  "updatedAt": "2026-03-31T00:00:00Z"
}
```

### 6.2 PUT /api/workspaces/:workspaceId/members/:memberId/privilege-domains

Request body:
```json
{
  "structural_admin": true,
  "data_access": false
}
```

Respuestas:
- `200 OK` — actualización exitosa
- `400 LAST_STRUCTURAL_ADMIN` — se intentó revocar el único structural-admin del workspace
- `403 FORBIDDEN` — actor no tiene permiso para gestionar dominios
- `409 CONFLICT` — actualización concurrente detectada

### 6.3 GET /api/security/privilege-domains/denials

Query params: `tenantId`, `workspaceId`, `requiredDomain`, `actorId`, `from`, `to`, `limit`, `offset`

Respuesta:
```json
{
  "denials": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "workspaceId": "uuid",
      "actorId": "text",
      "actorType": "user|api_key|service_account",
      "credentialDomain": "data_access",
      "requiredDomain": "structural_admin",
      "httpMethod": "POST",
      "requestPath": "/v1/schemas",
      "sourceIp": "1.2.3.4",
      "correlationId": "text",
      "deniedAt": "2026-03-31T00:00:00Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

### 6.4 POST /api/admin/api-keys/:keyId/migrate-domain

Request body:
```json
{
  "privilegeDomain": "structural_admin"
}
```
Disponible sólo durante el período de gracia para keys `pending_classification`.

### 6.5 Eventos Kafka

```jsonc
// console.security.privilege-domain-denied
{
  "eventType": "privilege_domain_denied",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "actorId": "text",
  "actorType": "user|api_key",
  "credentialDomain": "data_access|structural_admin|none",
  "requiredDomain": "structural_admin|data_access",
  "httpMethod": "POST",
  "requestPath": "/v1/schemas",
  "correlationId": "text",
  "occurredAt": "iso8601"
}

// console.security.privilege-domain-assigned
{
  "eventType": "privilege_domain_assigned",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "memberId": "uuid",
  "privilegeDomain": "structural_admin|data_access",
  "assignedBy": "uuid",
  "occurredAt": "iso8601"
}

// console.security.privilege-domain-revoked
{
  "eventType": "privilege_domain_revoked",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "memberId": "uuid",
  "privilegeDomain": "structural_admin|data_access",
  "revokedBy": "uuid",
  "occurredAt": "iso8601"
}

// console.security.last-admin-guard-triggered
{
  "eventType": "last_admin_guard_triggered",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "memberId": "uuid",
  "attemptedBy": "uuid",
  "occurredAt": "iso8601"
}
```

---

## 7. Artefactos impactados por componente

### services/gateway-config/

- **`plugins/scope-enforcement.lua`** — Añadir:
  1. Extracción del claim `privilege_domain` del JWT (o lookup de `api_keys.privilege_domain` via shared dict).
  2. Lookup `endpoint_privilege_domain_requirement` en nuevo shared dict `privilege_domain_cache` (TTL `PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS`, default 60 s).
  3. Evaluación de bypass para `platform_admin`.
  4. Generación del evento `privilege_domain_denied` y publicación fire-and-forget al sidecar Kafka.
  5. Inyección del header `X-Privilege-Domain`.
  6. Tests Lua (`busted`): nuevo archivo `tests/plugins/scope-enforcement-domain_spec.lua`.

- **`public-route-catalog.json`** — Añadir campo `privilege_domain` a cada entrada con la clasificación canónica.

- **`helm/`** — Nuevas variables de entorno en `values.yaml`:
  - `PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS` (default 60)
  - `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` (default false, flag de rollout)

### services/provisioning-orchestrator/src/

- **`migrations/094-admin-data-privilege-separation.sql`** — DDL completo descrito en §5.

- **`actions/privilege-domain-assign.mjs`** — Acción OpenWhisk para PUT assignment; incluye last-admin guard con `SELECT FOR UPDATE`, sincronización Keycloak, invalidación caché APISIX admin API, publicación Kafka.

- **`actions/privilege-domain-query.mjs`** — GET/LIST assignments para un workspace; usado por la consola y por `privilege-domain-audit-query`.

- **`actions/privilege-domain-audit-query.mjs`** — Consulta `privilege_domain_denials` con RBAC: superadmin ve todos los tenants; tenant-owner sólo su tenant.

- **`actions/privilege-domain-event-recorder.mjs`** — Consumer Kafka → INSERT en `privilege_domain_denials`.

- **`actions/api-key-domain-migration.mjs`** — One-shot: clasifica keys por heurística de uso, asigna dominio o marca `pending_classification`.

- **`models/privilege-domain-assignment.mjs`** — Entity model (validación, tipos).

- **`repositories/privilege-domain-repository.mjs`** — CRUD sobre `privilege_domain_assignments` + query sobre `privilege_domain_denials`.

- **`events/privilege-domain-events.mjs`** — Constantes de topic y constructores de payload de evento.

- **`tests/actions/privilege-domain-assign.test.mjs`** — Tests unitarios + integración.
- **`tests/actions/privilege-domain-audit-query.test.mjs`**
- **`tests/actions/api-key-domain-migration.test.mjs`**

### apps/web-console/src/

- **`pages/ConsolePrivilegeDomainPage.tsx`** — Vista principal de asignación de dominios por miembro:
  - Dos secciones visuales diferenciadas: "Structural Administration" / "Data Access".
  - Toggle switches con confirmación de cambio.
  - Guard UI: si el miembro es el único structural-admin, el toggle está deshabilitado con tooltip explicativo.
  - Estado de carga, error y confirmación (shadcn/ui Dialog de confirmación para revocaciones).

- **`pages/ConsolePrivilegeDomainAuditPage.tsx`** — Vista superadmin de denegaciones:
  - Tabla con filtros por dominio requerido, tenant, workspace, rango temporal.
  - Exportación CSV/JSON.
  - Badge de conteo de denegaciones en las últimas 24 h.

- **`pages/ConsolePrivilegeDomainPage.test.tsx`** — Vitest + RTL.
- **`pages/ConsolePrivilegeDomainAuditPage.test.tsx`**

- **`services/privilege-domain-api.ts`** — Cliente HTTP para los endpoints de asignación y auditoría.

### services/internal-contracts/src/

- **`privilege-domain-assignment.schema.json`** — JSON Schema de la entidad y los eventos.
- **`privilege-domain-denial.schema.json`** — JSON Schema del evento de denegación.

### docs/adr/

- **`adr-094-privilege-domain-separation.md`** — Decisión de arquitectura: dos dominios, extensión del plugin T03, Keycloak realm roles.

---

## 8. Variables de entorno nuevas

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PRIVILEGE_DOMAIN_CACHE_TTL_SECONDS` | `60` | TTL del caché de clasificación de endpoints en APISIX |
| `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` | `false` | Feature flag de rollout; `false` = log-only (no bloquea) |
| `PRIVILEGE_DOMAIN_LAST_ADMIN_GUARD_ENABLED` | `true` | Habilita el guard de último structural-admin |
| `APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS` | `14` | Días antes de que `pending_classification` bloquee |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_DENIED` | `console.security.privilege-domain-denied` | Topic de denegaciones |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_ASSIGNED` | `console.security.privilege-domain-assigned` | Topic de asignaciones |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_REVOKED` | `console.security.privilege-domain-revoked` | Topic de revocaciones |
| `PRIVILEGE_DOMAIN_KAFKA_TOPIC_LAST_ADMIN` | `console.security.last-admin-guard-triggered` | Topic de guard |
| `KEYCLOAK_ADMIN_URL` | (existente) | URL de Keycloak admin API para sincronización de roles |

---

## 9. Estrategia de pruebas

### 9.1 Tests unitarios (node:test / Vitest / busted)

- `privilege-domain-assign.mjs`: last-admin guard (race-free), Keycloak sync mock, Kafka publish mock.
- `privilege-domain-audit-query.mjs`: RBAC superadmin vs tenant-owner, filtros de query.
- `api-key-domain-migration.mjs`: clasificación heurística, fallback a `pending_classification`.
- Plugin Lua: evaluación correcta del dominio, bypass `platform_admin`, denial path, ausencia de claim.
- `ConsolePrivilegeDomainPage.tsx`: render de dos secciones, toggle guard, confirmación de cambio.

### 9.2 Tests de integración (node:test + Docker Compose / testcontainers)

- PUT privilege assignment → INSERT en `privilege_domain_assignments` → rol en Keycloak sync → evento Kafka → INSERT en `privilege_domain_assignment_history`.
- Last-admin guard: `SELECT FOR UPDATE` previene race condition entre dos revocaciones concurrentes.
- APISIX plugin: petición de `data_access` credential a endpoint `structural_admin` → 403 + evento Kafka → INSERT en `privilege_domain_denials`.
- API key con `privilege_domain = structural_admin` llamando a endpoint `data_access` → 403.
- `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = false` → log-only, petición pasa.

### 9.3 Tests de contrato (JSON Schema / OpenAPI)

- Eventos Kafka validados contra `privilege-domain-assignment.schema.json` y `privilege-domain-denial.schema.json`.
- Respuestas de acciones OpenWhisk validadas contra contratos OpenAPI.

### 9.4 Tests de aceptación (criterios verificables)

| ID | Escenario | Evidencia esperada |
|----|-----------|-------------------|
| AC-01 | Credential `data_access` intenta POST /v1/schemas | HTTP 403, evento Kafka, INSERT en `privilege_domain_denials` |
| AC-02 | Credential `structural_admin` intenta GET /v1/collections/:name/documents | HTTP 403, evento Kafka |
| AC-03 | Credential con ambos dominios (dual-role user) realiza op. estructural + data | Ambas OK; cada op. loggeada bajo dominio correcto |
| AC-04 | Tenant owner revoca structural_admin al único structural-admin | 400 LAST_STRUCTURAL_ADMIN, evento guard emitido |
| AC-05 | API key creada con `privilege_domain = data_access` llama endpoint structural | HTTP 403 |
| AC-06 | Cambio de dominio de asignación → sesión activa en ≤ 60 s rechazada por nuevo dominio | Medición temporal; Keycloak session invalidada |
| AC-07 | API key legacy sin dominio dentro del grace period | Pasa (log warning); fuera del grace period: 403 |
| AC-08 | Superadmin filtra audit por `requiredDomain = structural_admin` | Sólo eventos structural en respuesta |

### 9.5 Validaciones operativas

- Migración SQL idempotente (re-run sin error).
- `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = false` → zero 403 new denials en producción durante roll-out.
- Caché APISIX invalidado correctamente tras cambio de asignación (verificado via admin API response).

---

## 10. Riesgos, migraciones y rollback

### 10.1 Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| API keys pre-existentes sin clasificar bloquean usuarios al activar enforcement | Alta | Alto | Grace period configurable (`APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS`); flag `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = false` durante rollout |
| Keycloak sync lento provoca propagación > 60 s | Media | Medio | Invalidación explícita de sesión Keycloak en la acción de asignación; caché APISIX flush via admin API |
| Race condition en last-admin guard | Baja | Alto | `SELECT FOR UPDATE` en la transacción de asignación; test de integración concurrente |
| Clasificación incompleta de endpoints (fail-closed) bloquea tráfico legítimo | Media | Alto | Rollout con `ENFORCEMENT_ENABLED = false`; validación del catálogo completo antes de habilitar |
| Extensión del plugin Lua introduce regresión en evaluación T03 | Media | Alto | Test suite Lua completa (`busted`) cubre T03 + T04; CI debe pasar antes del merge |

### 10.2 Migración

1. **Fase 0 (pre-enforcement)**: Desplegar migración SQL, clasificación de endpoints, migración de API keys con `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = false`. Observar logs de would-be denials.
2. **Fase 1 (log-only)**: Activar `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = false` (ya es default) pero procesar eventos Kafka y poblar `privilege_domain_denials` sin bloquear. Revisar falsos positivos.
3. **Fase 2 (enforcement)**: Cambiar `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = true`. Monitorizar tasa de 403 por dominio.
4. **Fase 3 (cleanup)**: Tras el grace period de API keys, cambiar constraint `privilege_domain NOT NULL` en tabla `api_keys`.

### 10.3 Rollback

- Setear `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED = false` via Helm upgrade (sin redeployment de código).
- La migración SQL es aditiva (nuevas tablas y columnas nullable); el rollback no requiere DROP de tablas.
- El plugin Lua usa la variable de entorno para no evaluar el dominio si el flag está desactivado.

### 10.4 Idempotencia

- `privilege-domain-assign.mjs`: `INSERT ... ON CONFLICT DO UPDATE` en `privilege_domain_assignments`.
- `api-key-domain-migration.mjs`: idempotente; no sobreescribe keys ya clasificadas.
- Migración SQL: todos los `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### 10.5 Observabilidad

- Métrica APISIX: `privilege_domain_denials_total{required_domain, credential_domain}` (Prometheus counter via APISIX metrics plugin).
- Log estructurado en cada denial: `{level: "warn", event: "privilege_domain_denied", actor, domain, path}`.
- Kafka consumer lag en `privilege-domain-event-recorder` (alert si lag > 1000 mensajes).
- Dashboard Grafana: denegaciones por dominio, por tenant, por hora.

---

## 11. Dependencias y secuencia de implementación

### 11.1 Dependencias previas requeridas

- **T01** (`091-secure-secret-storage`): Vault / ESO disponibles para gestión de credenciales Keycloak admin.
- **T02** (`092-secret-rotation-no-redeploy`): Rotación de credenciales Keycloak sin redeployment.
- **T03** (`093-scope-enforcement-blocking`): Plugin `scope-enforcement.lua` y tablas `endpoint_scope_requirements` y `scope_enforcement_denials` ya presentes; T04 extiende ambas.

### 11.2 Secuencia de implementación recomendada

```
Step 1: Migración SQL (094-admin-data-privilege-separation.sql)
        + clasificación inicial de endpoint_scope_requirements

Step 2: Extensión del plugin Lua scope-enforcement
        (extracción de claim + evaluación de dominio + flag enforcement)
        + tests busted

Step 3: privilege-domain-assign.mjs + privilege-domain-query.mjs
        (con last-admin guard + Keycloak sync + Kafka emit)
        + tests node:test

Step 4: privilege-domain-event-recorder.mjs
        (consumer Kafka → INSERT privilege_domain_denials)

Step 5: privilege-domain-audit-query.mjs
        + tests node:test

Step 6: api-key-domain-migration.mjs
        + tests node:test

Step 7: ConsolePrivilegeDomainPage.tsx + ConsolePrivilegeDomainAuditPage.tsx
        + privilege-domain-api.ts
        + tests Vitest

Step 8: Contratos JSON Schema + ADR + actualización AGENTS.md

Step 9: Helm values con nuevas env vars + smoke tests en staging

Step 10: Rollout con PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false
         → observar → activar enforcement
```

### 11.3 Paralelización posible

- Steps 3-5 (acciones backend) y Step 7 (UI) pueden desarrollarse en paralelo tras Step 2.
- Step 6 (migración de API keys) puede ejecutarse en paralelo con Step 7.

---

## 12. Criterios de done (Definition of Done)

| Criterio | Evidencia |
|----------|-----------|
| Todos los endpoints del catálogo público clasificados en exactamente un dominio | Campo `privilege_domain` NOT NULL en `endpoint_scope_requirements` para todas las rutas del catálogo; validación automatizada en CI |
| Enforcement funciona: credential A (data_access) → endpoint B (structural_admin) → HTTP 403 | Test de aceptación AC-01 y AC-02 pasan en CI |
| Last-admin guard: no se puede revocar el único structural-admin | Test AC-04 pasa; test de concurrencia pasa |
| API keys requieren exactamente un dominio en creación | Constraint PostgreSQL activo; test unitario de validación |
| Migración de API keys existentes completada o flagged en grace period | Script de migración ejecutado; query `WHERE privilege_domain IS NULL` retorna 0 fuera del grace period |
| Propagación ≤ 60 s medida | Test de integración temporal AC-06 pasa |
| Audit log consultable por dominio | Test AC-08 pasa; endpoint devuelve sólo eventos del dominio filtrado |
| Plugin Lua: sin regresión en tests T03 | Suite `busted` completa (T03 + T04) pasa en CI |
| Consola muestra dos secciones de dominio claramente separadas | Screenshot test o Vitest snapshot; revisión manual |
| Helm chart actualizado con nuevas env vars y valores por defecto | `helm lint` pasa; `helm template` genera los ConfigMaps correctos |
| ADR documentado en `docs/adr/` | Archivo presente en el PR |
| AGENTS.md actualizado con entidades, topics y env vars nuevas | Sección "Scope Enforcement" o nueva sección "Admin-Data Privilege Separation" presente |
| Feature flag permite rollout sin 403 inesperados | `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false` → 0 nuevas entradas en `privilege_domain_denials` en staging |

---

## Project Structure

### Documentation (this feature)

```text
specs/094-admin-data-privilege-separation/
├── plan.md              ← este archivo
├── research.md          ← Phase 0 (generado por /speckit.plan)
├── data-model.md        ← Phase 1 (generado por /speckit.plan)
├── contracts/           ← Phase 1 (generado por /speckit.plan)
│   ├── privilege-domain-assignment.schema.json
│   └── privilege-domain-denial.schema.json
└── tasks.md             ← Phase 2 (generado por /speckit.tasks — NO por este comando)
```

### Source Code (repository root)

```text
services/gateway-config/
├── plugins/
│   └── scope-enforcement.lua          ← MODIFICADO (extensión T04)
├── public-route-catalog.json           ← MODIFICADO (campo privilege_domain)
└── helm/values.yaml                    ← MODIFICADO (nuevas env vars)

services/provisioning-orchestrator/src/
├── actions/
│   ├── privilege-domain-assign.mjs     ← NUEVO
│   ├── privilege-domain-query.mjs      ← NUEVO
│   ├── privilege-domain-audit-query.mjs ← NUEVO
│   ├── privilege-domain-event-recorder.mjs ← NUEVO
│   └── api-key-domain-migration.mjs   ← NUEVO
├── models/
│   └── privilege-domain-assignment.mjs ← NUEVO
├── repositories/
│   └── privilege-domain-repository.mjs ← NUEVO
├── events/
│   └── privilege-domain-events.mjs    ← NUEVO
├── migrations/
│   └── 094-admin-data-privilege-separation.sql ← NUEVO
└── tests/
    ├── actions/privilege-domain-assign.test.mjs ← NUEVO
    ├── actions/privilege-domain-audit-query.test.mjs ← NUEVO
    └── actions/api-key-domain-migration.test.mjs ← NUEVO

apps/web-console/src/
├── pages/
│   ├── ConsolePrivilegeDomainPage.tsx  ← NUEVO
│   ├── ConsolePrivilegeDomainPage.test.tsx ← NUEVO
│   ├── ConsolePrivilegeDomainAuditPage.tsx ← NUEVO
│   └── ConsolePrivilegeDomainAuditPage.test.tsx ← NUEVO
└── services/
    └── privilege-domain-api.ts         ← NUEVO

services/internal-contracts/src/
├── privilege-domain-assignment.schema.json ← NUEVO
└── privilege-domain-denial.schema.json ← NUEVO

docs/adr/
└── adr-094-privilege-domain-separation.md ← NUEVO
```

**Structure Decision**: Multi-service monorepo estándar del proyecto. No se crean nuevas carpetas de primer nivel. Todos los artefactos se integran en los servicios y apps ya existentes, siguiendo los patrones establecidos en T01–T03.
