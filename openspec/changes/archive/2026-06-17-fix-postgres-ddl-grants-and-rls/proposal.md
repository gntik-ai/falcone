Tracking issue: gntik-ai/falcone#494

## Why

The DDL `create table` path emits only `CREATE TABLE …` — it issues no GRANT to the api-key DB roles (`falcone_service`/`falcone_anon`) and installs no RLS. Because the data API runs as the api-key role, it then returns `TABLE_NOT_FOUND` for tables it just created. The DDL→data round-trip is broken: API-created tables are unusable.

Live proof (`tests/live-audit/specs/03-postgres-isolation.sh`, step "PG-2"): create table via API → insert via service key → **404 TABLE_NOT_FOUND**. (Evidence: `tests/live-audit/evidence/03-postgres-and-isolation.md`.)

## What Changes

- The DDL/provisioning path SHALL grant the api-key roles (`falcone_service`/`falcone_anon`) the appropriate privileges on each newly created table.
- The DDL/provisioning path SHALL install the tenant RLS policy on the new table (ties into A3).

## Capabilities

### New Capabilities

### Modified Capabilities

- `data-api`: Tables created through the DDL API are immediately usable by the issuing tenant's api-key role, with grants and tenant RLS installed at creation time.

## Impact

- DDL `create table` / provisioning path in the data API.
- Ties into A3 (`fix-postgres-tenant-db-isolation-and-rls`).
