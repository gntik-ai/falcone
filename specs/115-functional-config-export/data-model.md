# Modelo de Datos — US-BKP-02-T01: Exportación de configuración funcional de tenants

**Branch**: `115-functional-config-export` | **Fecha**: 2026-04-01

---

## DDL — Tabla de auditoría de exportaciones

### `config_export_audit_log`

```sql
-- Migration: services/provisioning-orchestrator/src/migrations/115-functional-config-export.sql

CREATE TABLE IF NOT EXISTS config_export_audit_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL,
  actor_id          TEXT        NOT NULL,
  actor_type        TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  domains_requested TEXT[]      NOT NULL,
  domains_exported  TEXT[]      NOT NULL,
  domains_failed    TEXT[]      NOT NULL DEFAULT '{}',
  domains_not_available TEXT[]  NOT NULL DEFAULT '{}',
  result_status     TEXT        NOT NULL CHECK (result_status IN ('ok', 'partial', 'failed')),
  artifact_bytes    INT,
  format_version    TEXT        NOT NULL DEFAULT '1.0',
  correlation_id    TEXT        NOT NULL,
  export_started_at TIMESTAMPTZ NOT NULL,
  export_ended_at   TIMESTAMPTZ NOT NULL,
  error_detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_export_tenant
  ON config_export_audit_log(tenant_id, export_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_config_export_actor
  ON config_export_audit_log(actor_id, export_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_config_export_corr_id
  ON config_export_audit_log(correlation_id);
```

> **Nota**: El artefacto JSON exportado **no se almacena** en la base de datos. Se devuelve como cuerpo de respuesta HTTP directamente al solicitante. La tabla solo registra metadata de auditoría.

---

## Tipos TypeScript / JSDoc compartidos (`collectors/types.mjs`)

```typescript
// DomainStatus: estado de un dominio en el artefacto de exportación
type DomainStatus = 'ok' | 'empty' | 'error' | 'not_available' | 'not_requested';

// CollectorResult: resultado que devuelve cada recolector
interface CollectorResult {
  domain_key: string;
  status: DomainStatus;
  exported_at: string;          // ISO 8601 UTC
  items_count?: number;
  data?: Record<string, unknown> | null;
  error?: string;               // solo si status === 'error'
  reason?: string;              // solo si status === 'not_available' | 'not_requested'
}

// ExportArtifact: artefacto completo de exportación
interface ExportArtifact {
  export_timestamp: string;     // ISO 8601 UTC
  tenant_id: string;
  format_version: string;       // '1.0' para esta tarea
  deployment_profile: string;
  correlation_id: string;
  domains: CollectorResult[];
}

// DomainAvailability: respuesta del endpoint de dominios exportables
interface DomainAvailability {
  domain_key: string;
  availability: 'available' | 'not_available' | 'degraded';
  description: string;
  reason?: string;              // si availability !== 'available'
}

// ExportDomainsResponse: respuesta del endpoint auxiliar
interface ExportDomainsResponse {
  tenant_id: string;
  deployment_profile: string;
  queried_at: string;           // ISO 8601 UTC
  domains: DomainAvailability[];
}
```

---

## Schema del artefacto de exportación por dominio

### Dominio `iam` (Keycloak)

```jsonc
{
  "domain_key": "iam",
  "status": "ok",
  "exported_at": "2026-04-01T12:00:01.100Z",
  "items_count": 15,
  "data": {
    "realm": {
      "realmName": "acme-corp",
      "displayName": "Acme Corporation",
      "ssoSessionMaxLifespan": 36000,
      "accessTokenLifespan": 300,
      "loginTheme": "default",
      "emailTheme": "default",
      "sslRequired": "external"
    },
    "roles": [
      { "name": "admin", "description": "Tenant admin role", "composite": false }
    ],
    "groups": [
      { "name": "developers", "path": "/developers", "subGroups": [] }
    ],
    "clients": [
      {
        "clientId": "acme-app",
        "name": "Acme Application",
        "protocol": "openid-connect",
        "publicClient": false,
        "redirectUris": ["https://app.acme.com/*"],
        "webOrigins": ["https://app.acme.com"],
        "defaultClientScopes": ["openid", "profile", "email"],
        "secret": "***REDACTED***"
      }
    ],
    "clientScopes": [
      { "name": "custom-scope", "protocol": "openid-connect", "description": "Custom tenant scope" }
    ],
    "identityProviders": [],
    "realmRoleMappings": []
  }
}
```

### Dominio `postgres_metadata`

```jsonc
{
  "domain_key": "postgres_metadata",
  "status": "ok",
  "exported_at": "2026-04-01T12:00:01.300Z",
  "items_count": 8,
  "data": {
    "schemas": [
      {
        "schema_name": "acme_corp",
        "owner": "acme_user",
        "tables": [
          {
            "table_name": "projects",
            "columns": [
              { "column_name": "id", "data_type": "uuid", "is_nullable": false, "column_default": "gen_random_uuid()" },
              { "column_name": "name", "data_type": "text", "is_nullable": false },
              { "column_name": "created_at", "data_type": "timestamptz", "is_nullable": false }
            ],
            "constraints": [
              { "constraint_name": "projects_pkey", "constraint_type": "PRIMARY KEY", "columns": ["id"] }
            ],
            "indexes": [
              { "index_name": "projects_name_idx", "columns": ["name"], "is_unique": true }
            ]
          }
        ],
        "views": [],
        "extensions": ["pgcrypto", "uuid-ossp"],
        "grants": [
          { "grantee": "acme_user", "privilege_type": "USAGE", "object_type": "SCHEMA" }
        ]
      }
    ]
  }
}
```

### Dominio `mongo_metadata`

```jsonc
{
  "domain_key": "mongo_metadata",
  "status": "ok",
  "exported_at": "2026-04-01T12:00:01.500Z",
  "items_count": 3,
  "data": {
    "databases": [
      {
        "db_name": "acme-corp",
        "collections": [
          {
            "collection_name": "events",
            "options": { "capped": false },
            "validator": { "$jsonSchema": { "bsonType": "object" } },
            "indexes": [
              { "name": "_id_", "key": { "_id": 1 }, "unique": false },
              { "name": "tenant_idx", "key": { "tenantId": 1 }, "unique": false }
            ]
          }
        ],
        "sharding": null
      }
    ]
  }
}
```

### Dominio `kafka`

```jsonc
{
  "domain_key": "kafka",
  "status": "ok",
  "exported_at": "2026-04-01T12:00:01.700Z",
  "items_count": 4,
  "data": {
    "topics": [
      {
        "name": "acme-corp.events",
        "partitions": 3,
        "replication_factor": 2,
        "config": {
          "retention.ms": "604800000",
          "cleanup.policy": "delete"
        }
      }
    ],
    "acls": [
      {
        "resource_type": "TOPIC",
        "resource_name": "acme-corp.events",
        "resource_pattern_type": "LITERAL",
        "principal": "User:acme-service",
        "host": "*",
        "operation": "READ",
        "permission_type": "ALLOW"
      }
    ],
    "consumer_groups": [
      {
        "group_id": "acme-corp.cg.event-processor",
        "state": "Empty",
        "members": []
      }
    ]
  }
}
```

### Dominio `functions`

```jsonc
{
  "domain_key": "functions",
  "status": "ok",
  "exported_at": "2026-04-01T12:00:02.000Z",
  "items_count": 2,
  "data": {
    "namespace": "acme-corp",
    "actions": [
      {
        "name": "hello-world",
        "namespace": "acme-corp",
        "version": "0.0.1",
        "kind": "nodejs:20",
        "limits": { "timeout": 6000, "memory": 256, "logs": 10 },
        "parameters": [
          { "key": "DB_URL", "value": "***REDACTED***", "init": false, "encrypt": true },
          { "key": "ENV", "value": "production", "init": false, "encrypt": false }
        ],
        "exec": {
          "kind": "nodejs:20",
          "code_base64": "dmFyIG1haW4gPSBmdW5jdGlvbihwYXJhbXMpIHsgcmV0dXJuIHsgbXNnOiAnSGVsbG8hJyB9OyB9Ow==",
          "code_available": true
        },
        "annotations": [{ "key": "web-export", "value": true }]
      }
    ],
    "packages": [],
    "triggers": [],
    "rules": []
  }
}
```

### Dominio `storage`

```jsonc
{
  "domain_key": "storage",
  "status": "ok",
  "exported_at": "2026-04-01T12:00:02.200Z",
  "items_count": 2,
  "data": {
    "buckets": [
      {
        "name": "acme-corp-assets",
        "region": "us-east-1",
        "versioning": "Enabled",
        "lifecycle_rules": [
          {
            "id": "expire-old-objects",
            "status": "Enabled",
            "expiration": { "days": 365 }
          }
        ],
        "bucket_policy": {
          "Version": "2012-10-17",
          "Statement": [
            {
              "Effect": "Allow",
              "Principal": { "AWS": "arn:aws:iam::acme-corp:user/app-service" },
              "Action": ["s3:GetObject"],
              "Resource": "arn:aws:s3:::acme-corp-assets/*"
            }
          ]
        },
        "cors_rules": [
          {
            "allowed_methods": ["GET"],
            "allowed_origins": ["https://app.acme.com"],
            "allowed_headers": ["*"],
            "max_age_seconds": 3600
          }
        ]
      }
    ]
  }
}
```

---

## Evento Kafka de auditoría — Schema

**Topic**: `console.config.export.completed` | **Retención**: 90 días

```jsonc
{
  "event_type": "config.export.completed",
  "schema_version": "1.0",
  "correlation_id": "req-lx4k3a-7f2z1q",
  "tenant_id": "acme-corp",
  "actor_id": "admin@example.com",
  "actor_type": "superadmin",           // superadmin | sre | service_account
  "domains_requested": ["iam", "kafka", "storage", "postgres_metadata", "mongo_metadata", "functions"],
  "domains_exported": ["iam", "kafka", "storage", "postgres_metadata"],
  "domains_failed": ["mongo_metadata"],
  "domains_not_available": ["functions"],
  "result_status": "partial",           // ok | partial | failed
  "artifact_bytes": 48230,
  "format_version": "1.0",
  "export_started_at": "2026-04-01T12:00:00.000Z",
  "export_ended_at":   "2026-04-01T12:00:02.500Z",
  "emitted_at":        "2026-04-01T12:00:02.550Z"
}
```

---

## Contratos de API (resumen)

Los contratos OpenAPI completos están en `specs/115-functional-config-export/contracts/`.

| Endpoint | Método | Contrato | Descripción |
|---|---|---|---|
| `/v1/admin/tenants/{tenant_id}/config/export` | `POST` | `tenant-config-export.json` | Exportación de configuración funcional |
| `/v1/admin/tenants/{tenant_id}/config/export/domains` | `GET` | `tenant-config-export-domains.json` | Lista de dominios exportables y su disponibilidad |

**Scopes requeridos**: `platform:admin:config:export`

**HTTP status codes**:
- `200 OK`: exportación completa (todos los dominios solicitados con status `ok` o `empty`)
- `207 Multi-Status`: exportación parcial (al menos un dominio con status `error`)
- `400 Bad Request`: dominio solicitado desconocido
- `403 Forbidden`: rol insuficiente
- `404 Not Found`: tenant no encontrado
- `422 Unprocessable Entity`: artefacto supera `EXPORT_MAX_ARTIFACT_BYTES`
- `429 Too Many Requests`: rate limit superado

---

## Componentes de consola (TypeScript)

### `configExportApi.ts`

```typescript
// Tipos principales del frontend
export interface ExportRequest {
  domains?: string[];  // undefined = todos los disponibles
}

export interface DomainResult {
  domain_key: string;
  status: 'ok' | 'empty' | 'error' | 'not_available' | 'not_requested';
  exported_at: string;
  items_count?: number;
  data?: unknown;
  error?: string;
  reason?: string;
}

export interface ExportArtifact {
  export_timestamp: string;
  tenant_id: string;
  format_version: string;
  deployment_profile: string;
  correlation_id: string;
  domains: DomainResult[];
}

export interface ExportDomainsResponse {
  tenant_id: string;
  deployment_profile: string;
  queried_at: string;
  domains: Array<{
    domain_key: string;
    availability: 'available' | 'not_available' | 'degraded';
    description: string;
    reason?: string;
  }>;
}

// Funciones fetch
export async function exportTenantConfig(tenantId: string, request: ExportRequest): Promise<ExportArtifact>;
export async function getExportableDomains(tenantId: string): Promise<ExportDomainsResponse>;
```
