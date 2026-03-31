CREATE TABLE IF NOT EXISTS tenant_plan_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_assignment_id UUID NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  previous_plan_id UUID NULL,
  new_plan_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id TEXT NULL,
  change_reason TEXT NULL,
  change_direction TEXT NOT NULL CHECK (change_direction IN ('upgrade', 'downgrade', 'lateral', 'equivalent', 'initial_assignment')),
  usage_collection_status TEXT NOT NULL CHECK (usage_collection_status IN ('complete', 'partial', 'unavailable')),
  over_limit_dimension_count INTEGER NOT NULL DEFAULT 0,
  assignment_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_change_history_tenant_effective_at
  ON tenant_plan_change_history (tenant_id, effective_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_change_history_actor_effective_at
  ON tenant_plan_change_history (actor_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS tenant_plan_quota_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  history_entry_id UUID NOT NULL REFERENCES tenant_plan_change_history(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  dimension_key TEXT NOT NULL,
  display_label TEXT NULL,
  unit TEXT NULL,
  previous_effective_value_kind TEXT NOT NULL CHECK (previous_effective_value_kind IN ('bounded', 'unlimited', 'missing')),
  previous_effective_value INTEGER NULL,
  new_effective_value_kind TEXT NOT NULL CHECK (new_effective_value_kind IN ('bounded', 'unlimited', 'missing')),
  new_effective_value INTEGER NULL,
  comparison TEXT NOT NULL CHECK (comparison IN ('increased', 'decreased', 'unchanged', 'added', 'removed')),
  observed_usage INTEGER NULL,
  usage_observed_at TIMESTAMPTZ NULL,
  usage_source TEXT NULL,
  usage_status TEXT NOT NULL CHECK (usage_status IN ('within_limit', 'at_limit', 'over_limit', 'unknown')),
  usage_unknown_reason TEXT NULL,
  is_hard_decrease BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (history_entry_id, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_quota_impacts_dimension_usage_status
  ON tenant_plan_quota_impacts (dimension_key, usage_status);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_quota_impacts_tenant_effective_at
  ON tenant_plan_quota_impacts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_plan_capability_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  history_entry_id UUID NOT NULL REFERENCES tenant_plan_change_history(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  capability_key TEXT NOT NULL,
  display_label TEXT NULL,
  previous_state BOOLEAN NULL,
  new_state BOOLEAN NULL,
  comparison TEXT NOT NULL CHECK (comparison IN ('enabled', 'disabled', 'unchanged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (history_entry_id, capability_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_capability_impacts_capability_key
  ON tenant_plan_capability_impacts (capability_key);

CREATE INDEX IF NOT EXISTS idx_tenant_plan_capability_impacts_tenant_created_at
  ON tenant_plan_capability_impacts (tenant_id, created_at DESC);
