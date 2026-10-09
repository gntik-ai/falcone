// Tenant membership read model. Identity-provider calls stay within the tenant realm.
import * as store from './tenant-store.mjs';
import { kcAdmin, safeKeycloakAdminMessage } from './kc-admin.mjs';
import { canManageTenant } from './tenant-scope.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const ROLE_READ_CONCURRENCY = 8;

export async function listTenantUsers(ctx) {
  const tenant = await (ctx.store ?? store).getTenant(ctx.pool, ctx.params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', 'Tenant not found');
  if (!canManageTenant(ctx.identity, tenant.id)) {
    return err(403, 'FORBIDDEN', 'Requires a tenant owner or administrator');
  }
  const kc = ctx.kcAdmin ?? kcAdmin;
  try {
    const users = await kc.listUsers(tenant.iam_realm, { max: Number(ctx.params.max ?? ctx.query?.max ?? 100) });
    const items = [];
    // Avoid a burst of up to 100 role reads against Keycloak, preserving list order.
    for (let offset = 0; offset < users.length; offset += ROLE_READ_CONCURRENCY) {
      const batch = await Promise.all(users.slice(offset, offset + ROLE_READ_CONCURRENCY).map(async user => ({
        id: user.id, username: user.username, email: user.email, enabled: user.enabled,
        firstName: user.firstName, lastName: user.lastName, createdTimestamp: user.createdTimestamp,
        roles: (await kc.listUserRealmRoles(tenant.iam_realm, user.id))
          .map(role => role.name).filter(name => name && !name.startsWith('default-roles'))
      })));
      items.push(...batch);
    }
    return ok(200, { items, total: items.length, realm: tenant.iam_realm });
  } catch (error) {
    const status = Number(error?.statusCode ?? error?.kcStatus);
    return err(status >= 400 && status < 500 ? status : 502, 'IAM_LIST_TENANT_USERS_FAILED', safeKeycloakAdminMessage(error));
  }
}
