# Authorize workspace reads and provisioning from the shipped model

## Why

Issue #1008: single-workspace GET rejects five roles that have workspace.read in
its published authorization model. Its same-tenant denial incorrectly names
another tenant. Meanwhile an unbound workspace_admin can issue API keys and
configure providers through the executor, although GET is denied.

## What Changes

- Load the internal-contracts authorization model once at module initialization.
  Authorize the four local routes from verified identity.roles, tenantId and
  workspaceIds. Unknown roles/actions deny; tenant grants apply throughout the
  verified tenant, and workspace grants require an explicit matching binding.
- Gate workspace GET on workspace.read, PostgreSQL provision on database.admin,
  bucket create on bucket.admin and topic create on topic.admin. Keep each gate
  local to its route; do not widen canManageTenant or resolveWorkspaceForManage.
- Move only database.admin, bucket.admin and topic.admin from denied_actions to
  allowed_actions for tenant_owner and tenant_admin, preserving their creates.
- Deny absent workspaceIds on executor structural writes by workspace_owner,
  workspace_admin, workspace_developer and workspace_viewer. Empty or different
  bindings remain denied. Preserve broad tenant/platform admin exemptions and
  the earlier API-key identity denial.
- Preserve 404 no-leak paths, response shapes and error codes. Same-tenant GET
  denials identify insufficient workspace authority instead of another tenant.
- Package the new helper in the control-plane image.

## Scope and Compatibility

Tenant developer/viewer reads work with or without a workspace binding. Bound
workspace admins can provision; developers/viewers still cannot create because
create requires *.admin, not *.write. Workspace roles with no binding must be
bound before using the affected routes; this intentionally denies formerly
permitted unbound workspace-admin API-key/provider writes.

No function-family change, other canManageTenant migration, claim minting, custom
role/console change, migration, dependency or deployment-repository edit is
included. Superadmin/internal and platform-admin behavior remains unchanged.
Rollback is a source revert and the normal previous-image-digest release path.

## Verification Seams

Tests exercise the public model helper, LOCAL_HANDLERS responses, and real Node
HTTP parsing through createControlPlaneServer using an in-memory transport.
Only database, Kafka, S3 and verified-identity boundaries are substituted;
provider executors and API-key store code run unchanged. Database authorization
uses the accepted DB_ALREADY_PROVISIONED outcome, without provisioning a live DB.
