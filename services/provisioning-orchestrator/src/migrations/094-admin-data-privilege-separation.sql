-- 094-admin-data-privilege-separation.sql

CREATE TABLE IF NOT EXISTS privilege_domain_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  member_id UUID NOT NULL,
  structural_admin BOOLEAN NOT NULL DEFAULT false,
  data_access BOOLEAN NOT NULL DEFAULT false,
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_pda_workspace_member
  ON privilege_domain_assignments (workspace_id, member_id);

CREATE INDEX IF NOT EXISTS idx_pda_tenant_structural
  ON privilege_domain_assignments (tenant_id, workspace_id)
  WHERE structural_admin = true;

CREATE OR REPLACE VIEW workspace_structural_admin_count AS
  SELECT workspace_id, tenant_id, COUNT(*) AS structural_admin_count
  FROM privilege_domain_assignments
  WHERE structural_admin = true
  GROUP BY workspace_id, tenant_id;

CREATE TABLE IF NOT EXISTS privilege_domain_denials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','anonymous')),
  credential_domain TEXT CHECK (credential_domain IN ('structural_admin','data_access','none')),
  required_domain TEXT NOT NULL CHECK (required_domain IN ('structural_admin','data_access')),
  http_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  source_ip INET,
  correlation_id TEXT NOT NULL,
  denied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (correlation_id)
);

CREATE INDEX IF NOT EXISTS idx_pdd_tenant_denied_at
  ON privilege_domain_denials (tenant_id, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdd_workspace_denied_at
  ON privilege_domain_denials (workspace_id, denied_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pdd_required_domain
  ON privilege_domain_denials (required_domain, denied_at DESC);

CREATE TABLE IF NOT EXISTS privilege_domain_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  member_id UUID NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('assigned','revoked','migrated','system')),
  privilege_domain TEXT NOT NULL CHECK (privilege_domain IN ('structural_admin','data_access')),
  changed_by UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_pdah_workspace_member
  ON privilege_domain_assignment_history (workspace_id, member_id, changed_at DESC);

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS privilege_domain TEXT
    CHECK (privilege_domain IN ('structural_admin','data_access','pending_classification'));

ALTER TABLE endpoint_scope_requirements
  ADD COLUMN IF NOT EXISTS privilege_domain TEXT
    CHECK (privilege_domain IN ('structural_admin','data_access'));

-- Endpoint classification seed
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'POST'   AND request_path = '/v1/tenants' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'PUT'    AND request_path LIKE '/v1/tenants/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/tenants/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'POST'   AND request_path = '/v1/workspaces' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'PUT'    AND request_path LIKE '/v1/workspaces/%' AND request_path NOT LIKE '/v1/workspaces/%/members%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/workspaces/%' AND request_path NOT LIKE '/v1/workspaces/%/members%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'POST'   AND request_path LIKE '/v1/workspaces/%/members' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/workspaces/%/members/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'GET'    AND request_path LIKE '/v1/workspaces/%/members' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'POST'   AND request_path = '/v1/schemas' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'PUT'    AND request_path LIKE '/v1/schemas/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/schemas/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'GET'    AND request_path = '/v1/schemas' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'POST'   AND request_path = '/v1/functions' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/functions/%' AND request_path NOT LIKE '/v1/functions/%/invoke' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'PUT'    AND request_path LIKE '/v1/functions/%/config' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'POST'   AND request_path = '/v1/api-keys' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/api-keys/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'POST'   AND request_path = '/v1/services/configure' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'structural_admin' WHERE request_method = 'PUT'    AND request_path = '/v1/quotas' AND privilege_domain IS NULL;

UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'GET'    AND request_path LIKE '/v1/collections/%/documents' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'POST'   AND request_path LIKE '/v1/collections/%/documents' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'PUT'    AND request_path LIKE '/v1/collections/%/documents/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/collections/%/documents/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'POST'   AND request_path LIKE '/v1/collections/%/query' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'GET'    AND request_path LIKE '/v1/objects/%/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'PUT'    AND request_path LIKE '/v1/objects/%/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'DELETE' AND request_path LIKE '/v1/objects/%/%' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'POST'   AND request_path LIKE '/v1/functions/%/invoke' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'GET'    AND request_path = '/v1/analytics/query' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'POST'   AND request_path = '/v1/events/publish' AND privilege_domain IS NULL;
UPDATE endpoint_scope_requirements SET privilege_domain = 'data_access' WHERE request_method = 'GET'    AND request_path = '/v1/events/subscribe' AND privilege_domain IS NULL;
