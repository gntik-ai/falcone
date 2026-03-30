CREATE TABLE IF NOT EXISTS workspace_openapi_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  spec_version VARCHAR(64) NOT NULL,
  content_hash VARCHAR(72) NOT NULL,
  format_json TEXT NOT NULL,
  format_yaml TEXT NOT NULL,
  capability_tags TEXT[] NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_current UNIQUE (workspace_id, is_current) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_wov_workspace_current
  ON workspace_openapi_versions (workspace_id, is_current)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_wov_tenant
  ON workspace_openapi_versions (tenant_id);
