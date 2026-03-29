CREATE TABLE IF NOT EXISTS saga_instances (
  saga_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  correlation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'executing',
  -- valid values: executing | compensating | completed | compensated | compensation-failed
  recovery_policy TEXT NOT NULL DEFAULT 'compensate',
  -- valid values: resume | compensate
  input_snapshot JSONB NOT NULL,
  output_snapshot JSONB,
  error_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saga_instances_status_updated
  ON saga_instances(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_saga_instances_correlation
  ON saga_instances(correlation_id);
CREATE INDEX IF NOT EXISTS idx_saga_instances_tenant
  ON saga_instances(tenant_id);

CREATE TABLE IF NOT EXISTS saga_steps (
  step_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_id UUID NOT NULL REFERENCES saga_instances(saga_id),
  step_ordinal INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- valid values: pending | executing | succeeded | failed | compensating | compensated | compensation-failed
  input_snapshot JSONB NOT NULL,
  output_snapshot JSONB,
  error_detail JSONB,
  compensation_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(saga_id, step_ordinal)
);

CREATE INDEX IF NOT EXISTS idx_saga_steps_saga_id ON saga_steps(saga_id);

CREATE TABLE IF NOT EXISTS saga_compensation_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_id UUID NOT NULL REFERENCES saga_instances(saga_id),
  step_id UUID NOT NULL REFERENCES saga_steps(step_id),
  attempt INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  -- valid values: succeeded | failed | skipped-idempotent
  error_detail JSONB,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
