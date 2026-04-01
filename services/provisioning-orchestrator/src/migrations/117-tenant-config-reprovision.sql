-- Migration 117: Tenant config reprovision lock and audit tables
-- Idempotent: uses IF NOT EXISTS throughout

CREATE TABLE IF NOT EXISTS tenant_config_reprovision_locks (
  tenant_id          TEXT        PRIMARY KEY,
  lock_token         UUID        NOT NULL DEFAULT gen_random_uuid(),
  actor_id           TEXT        NOT NULL,
  actor_type         TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  source_tenant_id   TEXT        NOT NULL,
  dry_run            BOOLEAN     NOT NULL DEFAULT FALSE,
  correlation_id     TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired', 'failed')),
  acquired_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  released_at        TIMESTAMPTZ,
  last_heartbeat_at  TIMESTAMPTZ,
  error_detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_reprovision_lock_status_expires
  ON tenant_config_reprovision_locks(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_reprovision_lock_correlation
  ON tenant_config_reprovision_locks(correlation_id);

CREATE TABLE IF NOT EXISTS config_reprovision_audit_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT        NOT NULL,
  source_tenant_id      TEXT        NOT NULL,
  actor_id              TEXT        NOT NULL,
  actor_type            TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  dry_run               BOOLEAN     NOT NULL DEFAULT FALSE,
  requested_domains     TEXT[]      NOT NULL,
  effective_domains     TEXT[]      NOT NULL DEFAULT '{}',
  identifier_map_hash   TEXT,
  artifact_checksum     TEXT,
  format_version        TEXT        NOT NULL,
  result_status         TEXT        NOT NULL CHECK (result_status IN ('success', 'partial', 'failed', 'blocked', 'dry_run')),
  domain_summary        JSONB,
  resource_summary      JSONB,
  correlation_id        TEXT        NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ NOT NULL,
  error_detail          TEXT
);

CREATE INDEX IF NOT EXISTS idx_reprovision_audit_tenant
  ON config_reprovision_audit_log(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reprovision_audit_source_tenant
  ON config_reprovision_audit_log(source_tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reprovision_audit_correlation
  ON config_reprovision_audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_reprovision_audit_actor
  ON config_reprovision_audit_log(actor_id, started_at DESC);
