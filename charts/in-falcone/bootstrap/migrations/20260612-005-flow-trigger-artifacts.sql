-- Flow trigger registration + per-trigger HMAC secret storage for the trigger plane
-- (change add-flows-triggers).
--
-- Two tables make a published flow's trigger declarations addressable by the trigger plane:
--   flow_trigger_secrets       : per-webhook-trigger HMAC secret, encrypted at rest with
--                                AES-256-GCM (encryptSecret from
--                                services/webhook-engine/src/webhook-signing.mjs). The
--                                (tenant_id, workspace_id) columns are NOT NULL and indexed so the
--                                data-access predicate prevents cross-tenant secret reads — the
--                                same isolation pattern as
--                                services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql.
--   flow_trigger_registrations : the active (flow_id, version) -> trigger binding the cron
--                                schedule manager and the platform-event consumer look up. The
--                                version swap on publish upserts this row so future activations
--                                target the new version while in-flight runs keep their pinned one.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS) so the Helm migration workflow can reapply safely.
-- RLS policies + role grants are applied by the companion migration
-- 20260612-006-flow-trigger-rls.sql (kept separate so the table DDL is reusable without RLS in
-- environments that provision isolation differently — mirrors the 003/004 split).

CREATE TABLE IF NOT EXISTS flow_trigger_secrets (
  id            text        NOT NULL DEFAULT gen_random_uuid()::text,
  trigger_id    text        NOT NULL,
  flow_id       text        NOT NULL,
  tenant_id     text        NOT NULL,
  workspace_id  text        NOT NULL,
  cipher        text        NOT NULL,
  iv            text        NOT NULL,
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (trigger_id, tenant_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_fts_tenant_workspace
  ON flow_trigger_secrets (tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_fts_flow
  ON flow_trigger_secrets (tenant_id, workspace_id, flow_id);

CREATE TABLE IF NOT EXISTS flow_trigger_registrations (
  id            text        NOT NULL DEFAULT gen_random_uuid()::text,
  flow_id       text        NOT NULL,
  version       integer     NOT NULL,
  trigger_id    text        NOT NULL,
  trigger_type  text        NOT NULL CHECK (trigger_type IN ('cron', 'webhook', 'platform_event')),
  trigger_def   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  topic_ref     text,
  tenant_id     text        NOT NULL,
  workspace_id  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (trigger_id, tenant_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_ftr_tenant_workspace
  ON flow_trigger_registrations (tenant_id, workspace_id);

-- The platform-event consumer looks up matching subscriptions by the structural topic ref.
CREATE INDEX IF NOT EXISTS idx_ftr_event_lookup
  ON flow_trigger_registrations (tenant_id, workspace_id, trigger_type, topic_ref);
