CREATE TABLE IF NOT EXISTS workspace_sub_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  dimension_key VARCHAR(64) NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
  allocated_value INTEGER NOT NULL CHECK (allocated_value >= 0),
  created_by VARCHAR(255) NOT NULL,
  updated_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workspace_sub_quota UNIQUE (tenant_id, workspace_id, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_sub_quotas_tenant
  ON workspace_sub_quotas (tenant_id, dimension_key);

DROP TRIGGER IF EXISTS trg_workspace_sub_quotas_updated_at ON workspace_sub_quotas;
CREATE TRIGGER trg_workspace_sub_quotas_updated_at
BEFORE UPDATE ON workspace_sub_quotas
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
