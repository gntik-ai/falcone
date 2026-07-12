ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS quota_type_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS quota_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  dimension_key VARCHAR(64) NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
  override_value BIGINT NOT NULL CHECK (override_value >= -1),
  quota_type VARCHAR(10) NOT NULL DEFAULT 'hard' CHECK (quota_type IN ('hard', 'soft')),
  grace_margin INTEGER NOT NULL DEFAULT 0 CHECK (grace_margin >= 0),
  justification TEXT NOT NULL CHECK (length(trim(justification)) BETWEEN 1 AND 1000),
  expires_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'revoked', 'expired')),
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_by UUID REFERENCES quota_overrides(id),
  revoked_by VARCHAR(255),
  revoked_at TIMESTAMPTZ,
  revocation_justification TEXT CHECK (revocation_justification IS NULL OR length(trim(revocation_justification)) <= 1000),
  modified_by VARCHAR(255),
  modified_at TIMESTAMPTZ,
  modification_justification TEXT CHECK (modification_justification IS NULL OR length(trim(modification_justification)) <= 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quota_overrides_active_tenant_dimension
  ON quota_overrides (tenant_id, dimension_key)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_quota_overrides_tenant_status ON quota_overrides (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_quota_overrides_dimension_key ON quota_overrides (dimension_key);
CREATE INDEX IF NOT EXISTS idx_quota_overrides_expiry_active ON quota_overrides (status, expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS quota_enforcement_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(255),
  dimension_key VARCHAR(64) NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
  attempted_action VARCHAR(128),
  current_usage BIGINT,
  effective_limit BIGINT NOT NULL,
  quota_type VARCHAR(10) NOT NULL CHECK (quota_type IN ('hard', 'soft')),
  grace_margin INTEGER NOT NULL DEFAULT 0 CHECK (grace_margin >= 0),
  effective_ceiling BIGINT NOT NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('override', 'plan', 'default')),
  decision VARCHAR(32) NOT NULL CHECK (decision IN ('allowed', 'hard_blocked', 'soft_grace_allowed', 'soft_grace_exhausted', 'unlimited', 'metering_unavailable')),
  actor_id VARCHAR(255),
  correlation_id VARCHAR(255),
  warning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quota_enforcement_log_tenant_created ON quota_enforcement_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quota_enforcement_log_dimension_created ON quota_enforcement_log (dimension_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quota_enforcement_log_actor_created ON quota_enforcement_log (actor_id, created_at DESC);
