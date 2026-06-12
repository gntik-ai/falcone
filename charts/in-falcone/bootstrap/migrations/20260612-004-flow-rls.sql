-- Row-Level Security for the flows control-plane tenant-scoped tables (change
-- add-flows-control-plane-api / #361).
--
-- Defense-in-depth backstop for tenant isolation, identical in spirit to
-- services/scheduling-engine/migrations/002-rls-scheduling-tables.sql: today isolation
-- depends on every query carrying a `WHERE tenant_id = $1 AND workspace_id = $2` predicate
-- (see apps/control-plane/src/runtime/flow-executor.mjs). A single forgotten predicate is a
-- silent cross-tenant IDOR leak. These policies make the database enforce the same
-- constraint, so a forgotten predicate yields zero rows instead of cross-tenant disclosure.
--
-- Mechanism: policies read the request's tenant/workspace from the session GUCs
-- `app.tenant_id` / `app.workspace_id`. The application sets them per transaction via
-- apps/control-plane/src/runtime/connection-registry.mjs::withWorkspaceClient (SET LOCAL /
-- set_config(..., true)). The `true` (missing_ok) flag on current_setting() returns NULL when
-- the GUC is unset, so an unscoped session matches no rows -> FAIL-CLOSED (reinforced by FORCE
-- RLS, which applies the policy to the table owner too). Only superuser / BYPASSRLS roles (the
-- migration runner + legitimate cross-tenant sweeps via withAdminClient) see all rows.
--
-- IMMUTABILITY (design.md D6): flow_versions grants SELECT + INSERT only to falcone_app — NOT
-- UPDATE or DELETE — so published version immutability is a database constraint, not merely an
-- API convention (mirrors services/openapi-sdk-service/migrations/088-workspace-openapi-versions.sql).
--
-- Idempotent: safe to re-run (DROP POLICY IF EXISTS before CREATE).

-- Application (non-superuser, non-BYPASSRLS) role the policies enforce against. Created here
-- as a NOLOGIN group role with table DML grants when absent; the environment provisions a
-- LOGIN member of this role (credentials live outside the schema).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
    CREATE ROLE falcone_app NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO falcone_app;

-- flow_definitions: tenant + workspace scoped (both NOT NULL). The draft head is mutable, so
-- falcone_app gets full DML.
ALTER TABLE flow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_definitions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_definitions_tenant_isolation ON flow_definitions;
CREATE POLICY flow_definitions_tenant_isolation ON flow_definitions
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_definitions TO falcone_app;

-- flow_versions: tenant + workspace scoped (both NOT NULL). Published versions are IMMUTABLE
-- (design.md D6) -> SELECT + INSERT only, no UPDATE/DELETE grant to falcone_app.
ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_versions_tenant_isolation ON flow_versions;
CREATE POLICY flow_versions_tenant_isolation ON flow_versions
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT ON flow_versions TO falcone_app;
