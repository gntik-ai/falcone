-- Migration: 004_restore_confirmations
-- Feature: US-BKP-01-T04 — Confirmaciones reforzadas y prechecks antes de restauraciones
-- Date: 2026-04-01

-- New audit event types for the existing trail
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.confirmation_pending';
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.confirmed';
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.aborted';
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.confirmation_expired';

-- Confirmation request status enum
CREATE TYPE restore_confirmation_status AS ENUM (
  'pending_confirmation',
  'confirmed',
  'aborted',
  'expired',
  'rejected'
);

-- Risk level enum
CREATE TYPE restore_risk_level AS ENUM (
  'normal',
  'elevated',
  'critical'
);

-- Confirmation decision enum
CREATE TYPE restore_confirmation_decision AS ENUM (
  'confirmed',
  'aborted',
  'expired'
);

-- Pending confirmation requests table
CREATE TABLE restore_confirmation_requests (
  id                       UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash               TEXT                          NOT NULL UNIQUE,
  tenant_id                TEXT                          NOT NULL,
  component_type           TEXT                          NOT NULL,
  instance_id              TEXT                          NOT NULL,
  snapshot_id              TEXT                          NOT NULL,
  requester_id             TEXT                          NOT NULL,
  requester_role           TEXT                          NOT NULL,
  scope                    TEXT                          NOT NULL DEFAULT 'partial',
  risk_level               restore_risk_level            NOT NULL DEFAULT 'normal',
  status                   restore_confirmation_status   NOT NULL DEFAULT 'pending_confirmation',
  prechecks_result         JSONB                         NOT NULL DEFAULT '[]',
  warnings_shown           JSONB                         NOT NULL DEFAULT '[]',
  available_second_factors JSONB                         NOT NULL DEFAULT '[]',
  decision                 restore_confirmation_decision,
  decision_at              TIMESTAMPTZ,
  second_factor_type       TEXT,
  second_actor_id          TEXT,
  operation_id             UUID,
  expires_at               TIMESTAMPTZ                   NOT NULL,
  created_at               TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rcr_token_hash
  ON restore_confirmation_requests(token_hash);

CREATE INDEX idx_rcr_tenant_pending
  ON restore_confirmation_requests(tenant_id, status, expires_at)
  WHERE status = 'pending_confirmation';

CREATE INDEX idx_rcr_requester
  ON restore_confirmation_requests(requester_id, created_at DESC);

CREATE INDEX idx_rcr_expires_pending
  ON restore_confirmation_requests(expires_at)
  WHERE status = 'pending_confirmation';

-- Rollback:
-- DROP TABLE restore_confirmation_requests;
-- DROP TYPE restore_confirmation_decision;
-- DROP TYPE restore_risk_level;
-- DROP TYPE restore_confirmation_status;
-- NOTE: PostgreSQL does not support REMOVE VALUE from an ENUM.
-- Reverting backup_audit_event_type requires recreating the type. See plan section 9.
