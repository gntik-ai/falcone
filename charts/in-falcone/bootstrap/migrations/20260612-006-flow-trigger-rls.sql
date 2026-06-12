-- Row-Level Security for the flow trigger-plane tenant-scoped tables (change add-flows-triggers).
--
-- Defense-in-depth backstop identical in spirit to 20260612-004-flow-rls.sql: today isolation
-- depends on every query carrying a `WHERE tenant_id = $1 AND workspace_id = $2` predicate (see
-- apps/control-plane/src/runtime/flow-trigger-registry.mjs). A single forgotten predicate is a
-- silent cross-tenant secret-disclosure / cross-tenant trigger leak. These policies make the
-- database enforce the same constraint, so a forgotten predicate yields zero rows instead of
-- cross-tenant disclosure.
--
-- Mechanism: policies read the request's tenant/workspace from the session GUCs `app.tenant_id` /
-- `app.workspace_id`, set per transaction by
-- apps/control-plane/src/runtime/connection-registry.mjs::withWorkspaceClient. current_setting(...,
-- true) returns NULL when the GUC is unset, so an unscoped session matches no rows -> FAIL-CLOSED
-- (reinforced by FORCE RLS). Only superuser / BYPASSRLS roles (the migration runner + the
-- tenant-purge sweep) see all rows.
--
-- Idempotent: safe to re-run (DROP POLICY IF EXISTS before CREATE).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
    CREATE ROLE falcone_app NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO falcone_app;

-- flow_trigger_secrets: tenant + workspace scoped (both NOT NULL). The application rotates
-- (insert + revoke) secrets on version swap, so falcone_app gets full DML.
ALTER TABLE flow_trigger_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_trigger_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_trigger_secrets_tenant_isolation ON flow_trigger_secrets;
CREATE POLICY flow_trigger_secrets_tenant_isolation ON flow_trigger_secrets
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_trigger_secrets TO falcone_app;

-- flow_trigger_registrations: tenant + workspace scoped (both NOT NULL). Upserted on publish /
-- version swap and deleted on unpublish, so falcone_app gets full DML.
ALTER TABLE flow_trigger_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_trigger_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS flow_trigger_registrations_tenant_isolation ON flow_trigger_registrations;
CREATE POLICY flow_trigger_registrations_tenant_isolation ON flow_trigger_registrations
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON flow_trigger_registrations TO falcone_app;
