import * as store from './tenant-store.mjs';
import { canManageTenant } from './tenant-scope.mjs';
import { safeKeycloakAdminMessage } from './kc-admin.mjs';

const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
export function statusFromError(error, fallback = 502) {
  const status = Number(error?.statusCode ?? error?.kcStatus);
  return status >= 400 && status < 500 ? status : fallback;
}
export function kcBackedErr(error, code) {
  return err(statusFromError(error), code, safeKeycloakAdminMessage(error));
}
// Returns the resolved workspace alongside authorization/realm errors so audit
// records can identify the target tenant. Callers must check error before use.
export async function resolveWorkspaceForManage(ctx) {
  const st = ctx.store ?? store;
  const ws = await st.getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!ws) return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
  if (!canManageTenant(ctx.identity, ws.tenant_id)) return { ws, error: err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin') };
  const tenant = await st.getTenant(ctx.pool, ws.tenant_id);
  if (!tenant?.iam_realm) return { ws, error: err(409, 'NO_REALM', 'tenant has no IAM realm') };
  return { ws, realm: tenant.iam_realm };
}
