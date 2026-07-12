-- Extend the per-tenant rotation policy table (migration 089) with storage
-- programmatic-credential age controls. Both columns are nullable so existing
-- rows are unaffected: a tenant with no storage age limit keeps
-- max_storage_credential_age_days = NULL and is exempt from the expiry sweep.

ALTER TABLE tenant_rotation_policies
  ADD COLUMN IF NOT EXISTS max_storage_credential_age_days INTEGER;

ALTER TABLE tenant_rotation_policies
  ADD COLUMN IF NOT EXISTS storage_credential_warn_before_expiry_days INTEGER DEFAULT 14;
