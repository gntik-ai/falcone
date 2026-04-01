-- Fixture: Test tenant seed for 115-functional-config-export integration tests
-- Safe to run multiple times (idempotent)

-- Create test schema simulating a tenant's PostgreSQL namespace
CREATE SCHEMA IF NOT EXISTS test_tenant_115;

CREATE TABLE IF NOT EXISTS test_tenant_115.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW test_tenant_115.active_users AS
  SELECT id, email, display_name FROM test_tenant_115.users WHERE created_at > NOW() - INTERVAL '90 days';

-- Ensure config_export_audit_log table exists (migration should have run)
-- This seed just validates the table is queryable
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'config_export_audit_log') THEN
    RAISE NOTICE 'config_export_audit_log table not found — run migration 115-functional-config-export.sql first';
  END IF;
END $$;
