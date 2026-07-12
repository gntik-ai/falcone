-- Row-Level Security for the realtime-gateway tenant-scoped tables.
-- See packages/scheduling-engine/migrations/002-rls-scheduling-tables.sql for the
-- mechanism (session GUCs app.tenant_id/app.workspace_id, fail-closed, FORCE RLS).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
    CREATE ROLE falcone_app NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO falcone_app;

-- realtime_sessions: tenant + workspace scoped.
ALTER TABLE realtime_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS realtime_sessions_tenant_isolation ON realtime_sessions;
CREATE POLICY realtime_sessions_tenant_isolation ON realtime_sessions
  USING (tenant_id = current_setting('app.tenant_id', true)
         AND workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)
              AND workspace_id = current_setting('app.workspace_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON realtime_sessions TO falcone_app;
