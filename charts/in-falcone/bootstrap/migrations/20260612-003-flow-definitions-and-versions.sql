-- Flow authoring storage for the tenant-facing flows control-plane API (change
-- add-flows-control-plane-api / #361).
--
-- Two tables:
--   flow_definitions : the mutable DRAFT HEAD per (tenant, workspace, flow). One row per
--                      flow; PATCH updates it in place. Holds both the canonical YAML the
--                      console editor round-trips and the parsed JSON the validator/runtime
--                      consume.
--   flow_versions    : IMMUTABLE published snapshots. Publishing freezes the current draft
--                      into a new (flow_id, version) row. Version numbers are assigned
--                      monotonically by the server. In-flight executions carry their own
--                      frozen copy (version pinning), so these rows are never updated/deleted.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS) so the Helm-side migration workflow can reapply
-- safely. RLS policies + role grants are applied by the companion migration
-- 20260612-004-flow-rls.sql (kept separate so the table DDL is reusable without RLS in
-- environments that provision isolation differently).

CREATE TABLE IF NOT EXISTS flow_definitions (
  tenant_id        text        NOT NULL,
  workspace_id     text        NOT NULL,
  flow_id          text        NOT NULL,
  name             text        NOT NULL,
  definition_yaml  text,
  definition_json  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  dsl_api_version  text        NOT NULL DEFAULT 'v1.0',
  status           text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flow_id),
  UNIQUE (tenant_id, workspace_id, flow_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_definitions_scope
  ON flow_definitions (tenant_id, workspace_id);

CREATE TABLE IF NOT EXISTS flow_versions (
  tenant_id        text        NOT NULL,
  workspace_id     text        NOT NULL,
  flow_id          text        NOT NULL,
  version          integer     NOT NULL,
  definition_yaml  text,
  definition_json  jsonb       NOT NULL,
  dsl_api_version  text        NOT NULL DEFAULT 'v1.0',
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_flow_versions_scope
  ON flow_versions (tenant_id, workspace_id, flow_id);
