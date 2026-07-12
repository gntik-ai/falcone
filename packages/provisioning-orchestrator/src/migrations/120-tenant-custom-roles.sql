-- Migration 119: Per-tenant custom role catalog
-- Feature: add-tenant-custom-rbac (issue #261) — tenant-scoped custom RBAC roles
-- Idempotent: safe to run multiple times.
--
-- Stores tenant-authored custom roles that bind a subset of permission_matrix
-- actions, namespaced with a `custom:` prefix to guarantee no collision with
-- RESERVED_ROLE_NAMES. Scoped to (tenant_id, workspace_id); workspace_id NULL
-- denotes a tenant-level role. Soft-deleted via deleted_at so that
-- effective-permissions recalculation can observe lifecycle transitions.

CREATE TABLE IF NOT EXISTS tenant_custom_roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  workspace_id    TEXT,
  role_name       TEXT        NOT NULL CHECK (role_name LIKE 'custom:%'),
  allowed_actions TEXT[]      NOT NULL DEFAULT '{}',
  created_by      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- One active role name per (tenant, workspace). Soft-deleted rows are excluded so
-- a name can be reused after deletion.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_custom_roles_scope_name
  ON tenant_custom_roles(tenant_id, workspace_id, role_name)
  WHERE deleted_at IS NULL;

-- Resolver lookup: all active custom roles for a (tenant, workspace) scope.
CREATE INDEX IF NOT EXISTS idx_tenant_custom_roles_scope
  ON tenant_custom_roles(tenant_id, workspace_id)
  WHERE deleted_at IS NULL;
