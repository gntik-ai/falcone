# fix-mongo-browse-tenant-scope

## Change type
bugfix

## Capability
document-store

## Priority
P0

## Why
The gateway routes `/v1/mongo/*` (JWT, no apikey) to the control-plane, whose mongo browse/list/document-read handlers omit the `tenantId` filter the executor adapter enforces → any tenant reads any database/collection/documents by name and enumerates all names.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** `acme-ops` JWT → `GET .../data/{globexDb}/collections/{c}/documents` → 200 returning globex's doc (`secret:"GLOBEX_PRIVATE"`); `GET /v1/mongo/databases` lists all tenants' names; `?filter=` exfiltration works. Root: `mongo-handlers.mjs` browse/documents unscoped (executor path scopes correctly).

GitHub issue #550 (epic #539). Evidence: `audit/live-campaign/evidence/21-document-mongo.md`.

## What Changes
Scope the control-plane mongo handlers by the caller's tenant (filter by `tenantId`, restrict listable names to the caller's workspaces) or route document reads through the scoped executor — kind `mongo-handlers.mjs` + product handler.

## Impact
Cross-tenant document read/list → empty/403; own data intact; live 2-tenant probe.

Dependencies: Relates to D2 (executor↔FerretDB).
