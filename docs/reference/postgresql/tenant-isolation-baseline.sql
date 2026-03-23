-- PostgreSQL tenant isolation baseline
--
-- Purpose:
--   Illustrative baseline for future implementation tasks that need a reusable
--   pattern for roles, schema grants, default privileges, and RLS context.
--
-- Notes:
--   - This file is intentionally conservative and not production-complete.
--   - It documents the architectural guardrails chosen in ADR 0002.
--   - Replace placeholder names and IDs through automation, not manual edits.

-- ---------------------------------------------------------------------------
-- 1. Reduce permissive defaults
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- Replace `shared_platform_db` with the actual database name through automation.
REVOKE ALL ON DATABASE shared_platform_db FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Role classes
-- ---------------------------------------------------------------------------
-- Runtime role: application queries only
CREATE ROLE platform_runtime NOINHERIT;

-- Migrator role: controlled DDL only
CREATE ROLE platform_migrator NOINHERIT;

-- Provisioner role: schema/database lifecycle automation only
CREATE ROLE platform_provisioner NOINHERIT;

-- Audit role: read-only verification and evidence collection
CREATE ROLE platform_audit_readonly NOINHERIT;

-- Break-glass role: exceptional use only, separately governed
CREATE ROLE platform_break_glass NOINHERIT;

-- ---------------------------------------------------------------------------
-- 3. Shared schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS control AUTHORIZATION platform_migrator;
REVOKE ALL ON SCHEMA control FROM PUBLIC;
GRANT USAGE ON SCHEMA control TO platform_runtime, platform_audit_readonly;

-- ---------------------------------------------------------------------------
-- 4. Tenant context helpers for RLS on shared tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION control.current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.tenant_id', true)
$$;

CREATE OR REPLACE FUNCTION control.current_workspace_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.workspace_id', true)
$$;

-- Example shared table carrying tenant-scoped rows.
CREATE TABLE IF NOT EXISTS control.workspace_memberships (
  tenant_id text NOT NULL,
  workspace_id text NOT NULL,
  user_id text NOT NULL,
  role_name text NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id, user_id)
);

ALTER TABLE control.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.workspace_memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_memberships_isolation ON control.workspace_memberships;
CREATE POLICY workspace_memberships_isolation
ON control.workspace_memberships
USING (
  tenant_id = control.current_tenant_id()
  AND workspace_id = control.current_workspace_id()
)
WITH CHECK (
  tenant_id = control.current_tenant_id()
  AND workspace_id = control.current_workspace_id()
);

GRANT SELECT, INSERT, UPDATE, DELETE
ON control.workspace_memberships
TO platform_runtime;
GRANT SELECT ON control.workspace_memberships TO platform_audit_readonly;

-- ---------------------------------------------------------------------------
-- 5. Shared-schema tenant provisioning pattern
-- ---------------------------------------------------------------------------
-- Replace `tenant_123` via automation from the placement catalog.
CREATE SCHEMA IF NOT EXISTS tenant_123 AUTHORIZATION platform_migrator;
REVOKE ALL ON SCHEMA tenant_123 FROM PUBLIC;
GRANT USAGE ON SCHEMA tenant_123 TO platform_runtime, platform_audit_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA tenant_123
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA tenant_123
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA tenant_123
  GRANT SELECT ON TABLES TO platform_audit_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA tenant_123
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA tenant_123
  GRANT USAGE, SELECT ON SEQUENCES TO platform_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE platform_migrator IN SCHEMA tenant_123
  GRANT SELECT ON SEQUENCES TO platform_audit_readonly;

-- Example tenant-owned table. Shared-schema placement isolates this by schema.
CREATE TABLE IF NOT EXISTS tenant_123.documents (
  document_id text PRIMARY KEY,
  workspace_id text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_123.documents TO platform_runtime;
GRANT SELECT ON tenant_123.documents TO platform_audit_readonly;

-- ---------------------------------------------------------------------------
-- 6. Dedicated-database consistency rule
-- ---------------------------------------------------------------------------
-- Dedicated-database tenants should still expose the same logical contract:
--   - same shared/control schema conventions where applicable
--   - same role classes
--   - same migration identifiers
--   - same verification scenarios
-- The difference is physical placement, not product semantics.
