-- Row-Level Security for the provisioning-orchestrator credential-rotation tables.
-- See packages/scheduling-engine/migrations/002-rls-scheduling-tables.sql for the
-- mechanism (session GUCs app.tenant_id/app.workspace_id, fail-closed, FORCE RLS).
--
-- Note: credential-rotation-expiry sweeps legitimately scan across tenants. Those
-- run under a superuser / BYPASSRLS connection (the migration-runner role), which
-- is unaffected by these policies; only the non-BYPASSRLS application role is scoped.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
    CREATE ROLE falcone_app NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO falcone_app;

-- service_account_rotation_states: tenant + workspace scoped.
ALTER TABLE service_account_rotation_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_account_rotation_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sa_rotation_states_tenant_isolation ON service_account_rotation_states;
CREATE POLICY sa_rotation_states_tenant_isolation ON service_account_rotation_states
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON service_account_rotation_states TO falcone_app;

-- service_account_rotation_history: tenant + workspace scoped.
ALTER TABLE service_account_rotation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_account_rotation_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sa_rotation_history_tenant_isolation ON service_account_rotation_history;
CREATE POLICY sa_rotation_history_tenant_isolation ON service_account_rotation_history
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON service_account_rotation_history TO falcone_app;

-- tenant_rotation_policies: tenant-scoped only (PK is tenant_id, no workspace_id).
ALTER TABLE tenant_rotation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_rotation_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rotation_policies_tenant_isolation ON tenant_rotation_policies;
CREATE POLICY tenant_rotation_policies_tenant_isolation ON tenant_rotation_policies
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_rotation_policies TO falcone_app;
