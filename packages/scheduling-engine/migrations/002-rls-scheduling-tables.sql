-- Row-Level Security for the scheduling-engine tenant-scoped tables.
--
-- Defense-in-depth backstop for tenant isolation: today isolation depends solely
-- on every query carrying a `WHERE tenant_id = $1 AND workspace_id = $2` predicate
-- (see packages/scheduling-engine/actions/scheduling-management.mjs). A single
-- forgotten predicate is a silent cross-tenant IDOR leak. These policies make the
-- database enforce the same constraint, so a forgotten predicate yields zero rows
-- instead of cross-tenant disclosure.
--
-- Mechanism: policies read the request's tenant/workspace from the session GUCs
-- `app.tenant_id` / `app.workspace_id`. The application sets them per transaction
-- via packages/adapters/src/tenant-rls-context.mjs (SET LOCAL ...). The `true`
-- (missing_ok) flag on current_setting() returns NULL when the GUC is unset, so an
-- unscoped session matches no rows -> FAIL-CLOSED (reinforced by FORCE RLS, which
-- applies the policy to the table owner too). Only superuser / BYPASSRLS roles
-- (the migration runner + legitimate cross-tenant sweeps) see all rows.
--
-- Idempotent: safe to re-run (DROP POLICY IF EXISTS before CREATE).

-- Application (non-superuser, non-BYPASSRLS) role the policies enforce against.
-- Created here as a NOLOGIN group role with table DML grants; the environment
-- provisions a LOGIN member of this role (credentials live outside the schema).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
    CREATE ROLE falcone_app NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO falcone_app;

-- scheduled_jobs: tenant + workspace scoped (both NOT NULL).
ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduled_jobs_tenant_isolation ON scheduled_jobs;
CREATE POLICY scheduled_jobs_tenant_isolation ON scheduled_jobs
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_jobs TO falcone_app;

-- scheduled_executions: tenant + workspace scoped (both NOT NULL).
ALTER TABLE scheduled_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduled_executions_tenant_isolation ON scheduled_executions;
CREATE POLICY scheduled_executions_tenant_isolation ON scheduled_executions
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_executions TO falcone_app;

-- scheduling_configurations: tenant-scoped (workspace_id is nullable -> a NULL
-- row is a tenant-level default, so scope by tenant only).
ALTER TABLE scheduling_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_configurations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scheduling_configurations_tenant_isolation ON scheduling_configurations;
CREATE POLICY scheduling_configurations_tenant_isolation ON scheduling_configurations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduling_configurations TO falcone_app;
