CREATE TABLE IF NOT EXISTS function_privilege_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  member_id UUID NOT NULL,
  function_deployment BOOLEAN NOT NULL DEFAULT false,
  function_invocation BOOLEAN NOT NULL DEFAULT false,
  assigned_by UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_fpa_workspace_member
  ON function_privilege_assignments (workspace_id, member_id);

CREATE INDEX IF NOT EXISTS idx_fpa_workspace_deploy
  ON function_privilege_assignments (workspace_id)
  WHERE function_deployment = true;

CREATE INDEX IF NOT EXISTS idx_fpa_workspace_invoke
  ON function_privilege_assignments (workspace_id)
  WHERE function_invocation = true;

CREATE TABLE IF NOT EXISTS function_privilege_denials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  workspace_id UUID,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','trigger_identity','anonymous')),
  attempted_operation TEXT NOT NULL CHECK (attempted_operation IN (
    'function_deploy','function_update','function_delete',
    'trigger_create','trigger_update','trigger_delete',
    'function_invoke','activation_read','result_read'
  )),
  required_subdomain TEXT NOT NULL CHECK (required_subdomain IN ('function_deployment','function_invocation')),
  presented_subdomains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  top_level_domain TEXT,
  request_path TEXT NOT NULL,
  http_method TEXT NOT NULL,
  target_function_id TEXT,
  correlation_id TEXT NOT NULL UNIQUE,
  denied_reason TEXT NOT NULL,
  source_ip INET,
  denied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpd_tenant_denied_at
  ON function_privilege_denials (tenant_id, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_fpd_workspace_denied_at
  ON function_privilege_denials (workspace_id, denied_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fpd_required_subdomain
  ON function_privilege_denials (required_subdomain, denied_at DESC);

CREATE TABLE IF NOT EXISTS function_privilege_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  member_id UUID NOT NULL,
  privilege_subdomain TEXT NOT NULL CHECK (privilege_subdomain IN ('function_deployment','function_invocation')),
  change_type TEXT NOT NULL CHECK (change_type IN ('assigned','revoked','migrated','system')),
  changed_by UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id TEXT
);

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS function_privileges TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE endpoint_scope_requirements
  ADD COLUMN IF NOT EXISTS function_privilege_subdomain TEXT
  CHECK (function_privilege_subdomain IN ('function_deployment','function_invocation'));

UPDATE endpoint_scope_requirements
   SET function_privilege_subdomain = 'function_deployment'
 WHERE (http_method, request_path) IN (
   ('POST', '/v1/functions/actions'),
   ('POST', '/v1/functions/workspaces/{workspaceId}/packages'),
   ('POST', '/v1/functions/workspaces/{workspaceId}/triggers'),
   ('POST', '/v1/functions/actions/{resourceId}/cron-triggers'),
   ('POST', '/v1/functions/actions/{resourceId}/kafka-triggers'),
   ('POST', '/v1/functions/actions/{resourceId}/storage-triggers'),
   ('PUT', '/v1/functions/actions/{resourceId}'),
   ('PUT', '/v1/functions/actions/{resourceId}/http-exposure'),
   ('PUT', '/v1/functions/workspaces/{workspaceId}/packages/{packageName}'),
   ('PUT', '/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}'),
   ('DELETE', '/v1/functions/actions/{resourceId}'),
   ('DELETE', '/v1/functions/actions/{resourceId}/cron-triggers/{triggerId}'),
   ('DELETE', '/v1/functions/actions/{resourceId}/kafka-triggers/{triggerId}'),
   ('DELETE', '/v1/functions/actions/{resourceId}/storage-triggers/{triggerId}'),
   ('DELETE', '/v1/functions/workspaces/{workspaceId}/packages/{packageName}'),
   ('DELETE', '/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}')
 );

UPDATE endpoint_scope_requirements
   SET function_privilege_subdomain = 'function_invocation'
 WHERE (http_method, request_path) IN (
   ('POST', '/v1/functions/actions/{resourceId}/invocations'),
   ('GET', '/v1/functions/actions/{resourceId}/activations'),
   ('GET', '/v1/functions/actions/{resourceId}/activations/{activationId}'),
   ('GET', '/v1/functions/actions/{resourceId}/activations/{activationId}/logs'),
   ('GET', '/v1/functions/actions/{resourceId}/activations/{activationId}/result'),
   ('POST', '/v1/functions/actions/{resourceId}/activations/{activationId}/rerun')
 );
