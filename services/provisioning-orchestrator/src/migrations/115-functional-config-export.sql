-- Migration: 115-functional-config-export
-- US-BKP-02-T01: Audit log for tenant functional configuration exports
-- Idempotent: safe to run multiple times

CREATE TABLE IF NOT EXISTS config_export_audit_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT        NOT NULL,
  actor_id              TEXT        NOT NULL,
  actor_type            TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  domains_requested     TEXT[]      NOT NULL,
  domains_exported      TEXT[]      NOT NULL,
  domains_failed        TEXT[]      NOT NULL DEFAULT '{}',
  domains_not_available TEXT[]      NOT NULL DEFAULT '{}',
  result_status         TEXT        NOT NULL CHECK (result_status IN ('ok', 'partial', 'failed')),
  artifact_bytes        INT,
  format_version        TEXT        NOT NULL DEFAULT '1.0',
  correlation_id        TEXT        NOT NULL,
  export_started_at     TIMESTAMPTZ NOT NULL,
  export_ended_at       TIMESTAMPTZ NOT NULL,
  error_detail          TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_export_tenant
  ON config_export_audit_log(tenant_id, export_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_config_export_actor
  ON config_export_audit_log(actor_id, export_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_config_export_corr_id
  ON config_export_audit_log(correlation_id);
