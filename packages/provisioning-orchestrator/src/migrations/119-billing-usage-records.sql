-- Migration 119: Billing usage records
-- Feature: add-usage-billing-export (#256) — projects per-tenant metered
-- consumption snapshots into immutable, idempotent billing usage records.
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS billing_usage_records (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                  TEXT        NOT NULL,
  tenant_id                 TEXT        NOT NULL,
  snapshot_at               TIMESTAMPTZ,
  dimensions                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  has_degraded_dimensions   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_billing_usage_records_cycle_tenant UNIQUE (cycle_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_usage_records_tenant
  ON billing_usage_records (tenant_id);
