-- 091-tenant-data-residency.sql
--
-- Feature: add-data-residency-pinning (issue #272).
--
-- Adds the per-tenant data residency region column. The `tenants` table is owned
-- by the deployment layer (no in-repo migration creates it; only 094 references
-- it via endpoint_scope_requirements UPDATEs). This migration is therefore
-- DEFENSIVE: it is a no-op (not an error) on databases that do not have the
-- tenants table, so it can run in every deployment regardless of who owns the
-- table.
--
-- The region is effectively IMMUTABLE after provisioning (design decision D2):
-- moving a tenant's data between regions is a destructive multi-step migration
-- handled by a separate, future saga. The column comment documents this.

ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS data_residency_region TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tenants'
      AND column_name = 'data_residency_region'
  ) THEN
    COMMENT ON COLUMN tenants.data_residency_region IS
      'Pinned data residency region (validated against deployment-topology supported_regions). Effectively immutable after provisioning; cross-region moves require a dedicated migration saga (feature add-data-residency-pinning, #272).';
  END IF;
END
$$;
