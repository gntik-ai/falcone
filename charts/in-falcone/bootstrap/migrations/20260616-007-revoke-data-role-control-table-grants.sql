-- Revoke data-role access to control-plane metadata tables (PG-3 fix).
-- Change: fix-postgres-tenant-db-isolation-and-rls (#490)
--
-- Root cause: deploy/kind/executor-demo.yaml ran
--   ALTER DEFAULT PRIVILEGES FOR ROLE falcone IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO falcone_anon, falcone_service;
-- This blanket default-privilege grant means EVERY table subsequently created by the
-- `falcone` user — including control-plane metadata tables (`workspace_api_keys`,
-- `workspace_embedding_providers`, `workspace_embedding_mappings`) — automatically
-- received SELECT and DML grants to the shared data roles. Because the data API
-- connects as `falcone_service`, any tenant key could potentially SELECT all
-- `workspace_api_keys` rows (all tenants' key hashes and metadata).
--
-- Fix:
--   1. Revoke the default-privilege grant so FUTURE control-plane tables no longer
--      receive the data-role grant automatically.
--   2. Explicitly REVOKE on the known control-plane tables that already have the
--      grant. Uses IF EXISTS to remain idempotent whether or not the roles exist.
--
-- Idempotent: safe to re-run (REVOKE on non-existent grants is a no-op; IF EXISTS
-- guards make role-absent runs silent).
--
-- Roles are optional (they may not exist in every environment; the executor-demo.yaml
-- setup job creates them). We guard with DO $$ blocks for idempotency.

-- 1. Remove the blanket default-privilege grant for future tables.
--    `FOR ROLE falcone` targets the default-privilege rule owned by the falcone user;
--    adjust to `FOR ROLE postgres` if the superuser is different in your environment
--    (the rule is keyed on the grantor, not the current user).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['falcone_service', 'falcone_anon'] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE falcone IN SCHEMA public
         REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM %I', r
      );
    END IF;
  END LOOP;
END
$$;

-- 2. Revoke existing grants on control-plane metadata tables.
--    These tables are created by `api-keys.mjs:ensureSchema()` and the embedding
--    executor's ensureSchema() — all in the shared `in_falcone` database and all
--    owned by `falcone`, so they received the default-privilege grants above.
DO $$
DECLARE
  tbl text;
  r   text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'workspace_api_keys',
    'workspace_embedding_providers',
    'workspace_embedding_mappings'
  ] LOOP
    IF EXISTS (
      SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      FOREACH r IN ARRAY ARRAY['falcone_service', 'falcone_anon'] LOOP
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', tbl, r
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;
