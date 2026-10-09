// Invitation HTTP seams are independent of unrelated data-plane SDKs.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import * as store from './tenant-store.mjs';
import { kcAdmin, TENANT_REALM_ROLES } from './kc-admin.mjs';
import { canManageTenant, isWorkspaceInviteOperator } from './tenant-scope.mjs';
import { recordAuditEventInTransaction } from './audit-store.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const invalidInvitation = () => err(400, 'INVITATION_INVALID', 'Invitation cannot be accepted');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const roles = new Set(TENANT_REALM_ROLES);
const aliases = new Map([['viewer', 'workspace_viewer'], ['editor', 'workspace_developer']]);
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const tokenDigest = value => createHash('sha256').update(value).digest('hex');
const emailHmac = (email, key) => createHmac('sha256', key).update(normalizeEmail(email)).digest('hex');
const expiresAt = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

// Shared with the public signup policy so invitations cannot bypass a stricter deployment policy.
export function signupPasswordMinLength() {
  const length = Number(process.env.CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH);
  return Number.isInteger(length) && length > 0 ? length : 8;
}

function keyFor(ctx) {
  // Production keys are injected by OpenBao/ESO. No default or unkeyed fallback.
  const config = ctx.invitationKey ?? { key: process.env.INVITATION_EMAIL_HMAC_KEY, id: process.env.INVITATION_EMAIL_HMAC_KEY_ID };
  if (!config.id || typeof config.key !== 'string' || Buffer.byteLength(config.key) < 32) return null;
  return config;
}
function keyError() { return err(503, 'INVITATION_KEY_UNAVAILABLE', 'Invitation service unavailable'); }
function sameHash(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left ?? '') || !/^[a-f0-9]{64}$/.test(right ?? '')) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function invitationOut(row) {
  return { id: row.id, role: row.role, workspaceId: row.workspace_id ?? null,
    status: row.status === 'failed' || (row.status === 'pending' && Date.parse(row.expires_at) <= Date.now()) ? 'expired' : row.status,
    expiresAt: row.expires_at, createdAt: row.created_at };
}
async function transaction(pool, fn) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  } finally { if (client !== pool) client.release(); }
}
async function audit(client, ctx, row, action, actorId = ctx.identity?.sub ?? 'unknown') {
  await recordAuditEventInTransaction(client, { actionType: `iam.invitation.${action}`, actorId,
    tenantId: row.tenant_id, workspaceId: row.workspace_id,
    correlationId: ctx.callerContext?.correlationId,
    newState: { eventType: `iam.invitation.${action}`, invitationId: row.id, role: row.role, status: row.status } });
}
function crossTenant(identity, tenantId) {
  return identity?.tenantId && identity.tenantId !== tenantId && !['superadmin', 'internal'].includes(identity.actorType);
}
async function managementScope(ctx, workspaceId) {
  const st = ctx.store ?? store;
  if (crossTenant(ctx.identity, ctx.params.tenantId)) return { error: err(404, 'NOT_FOUND', 'Invitation not found') };
  const tenant = await st.getTenant(ctx.pool, ctx.params.tenantId);
  if (!tenant) return { error: err(404, 'NOT_FOUND', 'Invitation not found') };
  const manager = canManageTenant(ctx.identity, tenant.id);
  if (!manager && !isWorkspaceInviteOperator(ctx.identity, workspaceId, tenant.id))
    return { error: err(403, 'FORBIDDEN', 'Invitation management requires an owner or administrator') };
  return { tenant, manager };
}
async function createInvitation(ctx) {
  const body = ctx.body ?? {};
  const st = ctx.store ?? store;
  if (crossTenant(ctx.identity, ctx.params.tenantId)) return err(404, 'NOT_FOUND', 'Invitation not found');
  const workspace = body.workspaceId ? await st.getWorkspace(ctx.pool, body.workspaceId) : null;
  const workspaceId = workspace?.id ?? body.workspaceId ?? null;
  const scope = await managementScope(ctx, workspaceId);
  if (scope.error) return scope.error;
  const key = keyFor(ctx);
  if (!key) return keyError();
  const email = normalizeEmail(body.email);
  if (!emailPattern.test(email) || body.emailHash !== undefined)
    return err(400, 'VALIDATION_ERROR', 'A valid email is required; emailHash is not supported');
  const role = aliases.get(body.role ?? body.roleName) ?? body.role ?? body.roleName;
  if (!roles.has(role)) return err(400, 'INVALID_ROLE', 'Unknown invitation role');
  if (role.startsWith('workspace_') && !workspaceId) return err(400, 'VALIDATION_ERROR', 'workspaceId is required for workspace roles');
  if (!scope.manager && !role.startsWith('workspace_')) return err(403, 'FORBIDDEN', 'Workspace operators may only invite workspace roles');
  if (workspaceId && (!workspace || workspace.tenant_id !== scope.tenant.id)) return err(404, 'NOT_FOUND', 'Workspace not found');
  const token = randomBytes(32).toString('base64url');
  const row = await transaction(ctx.pool, async client => {
    const invitation = await st.insertInvitation(client, {
      id: `inv_${randomUUID().replaceAll('-', '')}`, tenantId: scope.tenant.id, workspaceId,
      emailHash: emailHmac(email, key.key), emailHmacKeyId: key.id, tokenHash: tokenDigest(token),
      role, expiresAt: expiresAt(), createdBy: ctx.identity.sub
    });
    await audit(client, ctx, invitation, 'created');
    return invitation;
  });
  return ok(202, { ...invitationOut(row), entityId: row.id, entityType: 'invitation', token,
    acceptedEventType: 'iam.invitation.created' });
}

async function getInvitation(ctx) {
  if (!keyFor(ctx)) return keyError();
  if (crossTenant(ctx.identity, ctx.params.tenantId)) return err(404, 'NOT_FOUND', 'Invitation not found');
  const st = ctx.store ?? store;
  const row = await st.getInvitation(ctx.pool, ctx.params.tenantId, ctx.params.invitationId);
  if (!row) return err(404, 'NOT_FOUND', 'Invitation not found');
  const scope = await managementScope(ctx, row.workspace_id);
  return scope.error ?? ok(200, invitationOut(row));
}
async function listInvitations(ctx) {
  if (!keyFor(ctx)) return keyError();
  const requested = ctx.query?.workspaceId;
  const bound = [ctx.identity?.workspaceId, ...(ctx.identity?.workspaceIds ?? [])].filter(Boolean);
  const scope = await managementScope(ctx, requested ?? bound[0]);
  if (scope.error) return scope.error;
  const workspaceIds = requested ? [requested] : scope.manager ? null : bound.filter(id => isWorkspaceInviteOperator(ctx.identity, id, scope.tenant.id));
  const rows = await (ctx.store ?? store).listInvitations(ctx.pool, scope.tenant.id, workspaceIds);
  return ok(200, { items: rows.map(invitationOut), total: rows.length });
}

async function acceptInvitation(ctx) {
  const key = keyFor(ctx);
  if (!key) return keyError();
  const { token, password } = ctx.body ?? {};
  const email = normalizeEmail(ctx.body?.email ?? ctx.body?.primaryEmail);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !emailPattern.test(email)) {
    return invalidInvitation();
  }
  const st = ctx.store ?? store;
  const tokenHash = tokenDigest(token);
  const row = ctx.params.invitationId
    ? await st.getInvitation(ctx.pool, ctx.params.tenantId, ctx.params.invitationId)
    : await st.getInvitationByTokenHash(ctx.pool, ctx.params.tenantId, tokenHash);
  const emailHash = emailHmac(email, key.key);
  if (!row || row.status !== 'pending' || Date.parse(row.expires_at) <= Date.now()
      || row.email_hmac_key_id !== key.id || !sameHash(row.token_hash, tokenHash) || !sameHash(row.email_hash, emailHash)) {
    return invalidInvitation();
  }
  const tenant = await st.getTenant(ctx.pool, row.tenant_id);
  if (tenant?.status !== 'active' || !tenant.iam_realm || !roles.has(row.role)) return invalidInvitation();
  if (row.workspace_id) {
    const workspace = await st.getWorkspace(ctx.pool, row.workspace_id);
    if (!workspace || workspace.tenant_id !== tenant.id) return invalidInvitation();
  }
  const kc = ctx.kcAdmin ?? ctx._kcAdmin ?? kcAdmin;
  let existing;
  try {
    const candidates = (await kc.findUsersByEmail(tenant.iam_realm, email)).filter(user => normalizeEmail(user.email) === email);
    if (candidates.length > 1) return invalidInvitation();
    existing = candidates[0] ? structuredClone(candidates[0]) : null;
  } catch {
    return err(502, 'INVITATION_ACCEPT_FAILED', 'Invitation could not be completed');
  }
  // Linking an account requires its authenticated principal. An unverified public signup
  // cannot squat on an invited address and inherit the role when someone else consumes the link.
  if (existing && (ctx.identity?.sub !== existing.id || ctx.identity?.tenantId !== tenant.id)) {
    return invalidInvitation();
  }
  if (!existing && (typeof password !== 'string' || password.length < signupPasswordMinLength())) {
    return invalidInvitation();
  }
  const bindings = existing?.attributes?.workspace_id ?? [];
  if (existing && row.workspace_id && [].concat(bindings).some(id => id !== row.workspace_id)) {
    return invalidInvitation();
  }
  const claimed = await st.claimInvitation(ctx.pool, tenant.id, row.id, tokenHash, emailHash, key.id);
  if (!claimed) return invalidInvitation();
  let userId;
  let grantAttempted = false;
  let hadRole = false;
  try {
    const attributes = { ...(existing?.attributes ?? {}), tenant_id: [tenant.id],
      ...(row.workspace_id ? { workspace_id: [row.workspace_id] } : {}) };
    if (existing) {
      userId = existing.id;
      hadRole = (await kc.listUserRealmRoles(tenant.iam_realm, userId)).some(role => role.name === row.role);
      await kc.updateUser(tenant.iam_realm, userId, { emailVerified: true, attributes });
    } else {
      userId = await kc.createUser(tenant.iam_realm, {
        username: ctx.body.username ?? email, email, password, temporary: false, enabled: true,
        firstName: ctx.body.firstName ?? null, lastName: ctx.body.lastName ?? null,
        emailVerified: true, attributes
      });
      if (!userId) throw new Error('Identity provider did not return a user');
    }
    grantAttempted = true;
    await kc.assignRealmRoles(tenant.iam_realm, userId, [row.role]);
    await transaction(ctx.pool, async client => {
      const completed = await st.completeInvitation(client, tenant.id, row.id, userId);
      if (!completed) throw new Error('Invitation completion failed');
      await audit(client, ctx, completed, 'accepted', userId);
    });
    return ok(201, { id: row.id, userId, status: 'accepted', role: row.role, workspaceId: row.workspace_id ?? null });
  } catch {
    // Keep a failed claim unusable until an administrator explicitly resends it. If cleanup
    // itself fails, retain the accepted claim (fail closed), never issue a retryable token.
    try {
      if (userId && !existing) await kc.deleteUser(tenant.iam_realm, userId);
      if (existing) {
        if (grantAttempted && !hadRole) await kc.removeRealmRoles(tenant.iam_realm, userId, [row.role]);
        await kc.updateUser(tenant.iam_realm, userId, { emailVerified: existing.emailVerified === true, attributes: existing.attributes ?? {} });
      }
      await transaction(ctx.pool, async client => {
        const failed = await st.failInvitation(client, tenant.id, row.id);
        if (failed) await audit(client, ctx, failed, 'failed', userId ?? 'unknown');
      });
    } catch { /* retained claim prevents duplicate grants on uncertain compensation */ }
    return err(502, 'INVITATION_ACCEPT_FAILED', 'Invitation could not be completed');
  }
}

async function managedInvitation(ctx) {
  if (!keyFor(ctx)) return { error: keyError() };
  if (crossTenant(ctx.identity, ctx.params.tenantId)) return { error: err(404, 'NOT_FOUND', 'Invitation not found') };
  const row = await (ctx.store ?? store).getInvitation(ctx.pool, ctx.params.tenantId, ctx.params.invitationId);
  if (!row) return { error: err(404, 'NOT_FOUND', 'Invitation not found') };
  const scope = await managementScope(ctx, row.workspace_id);
  if (scope.error) return scope;
  if (!scope.manager && !row.role.startsWith('workspace_')) return { error: err(403, 'FORBIDDEN', 'Workspace operators may only manage workspace roles') };
  return { row };
}
async function revokeInvitation(ctx) {
  const found = await managedInvitation(ctx);
  if (found.error) return found.error;
  const row = await transaction(ctx.pool, async client => {
    const revoked = await (ctx.store ?? store).revokeInvitation(client, found.row.tenant_id, found.row.id, ctx.identity.sub);
    if (revoked) await audit(client, ctx, revoked, 'revoked');
    return revoked;
  });
  return row ? ok(200, invitationOut(row)) : err(409, 'INVITATION_NOT_PENDING', 'Invitation is not pending');
}
async function resendInvitation(ctx) {
  const found = await managedInvitation(ctx);
  if (found.error) return found.error;
  if (found.row.status === 'accepted') return err(409, 'INVITATION_NOT_PENDING', 'Invitation cannot be resent');
  const email = normalizeEmail(ctx.body?.email);
  if (!emailPattern.test(email)) return err(400, 'VALIDATION_ERROR', 'Re-enter the invitation email to resend');
  const key = keyFor(ctx);
  const emailHash = emailHmac(email, key.key);
  // A legacy row or an old key cannot be verified: the authorized admin explicitly reissues
  // it under the current key. Current-key invitations retain the same recipient.
  if (found.row.email_hmac_key_id === key.id && !sameHash(found.row.email_hash, emailHash))
    return err(400, 'VALIDATION_ERROR', 'Invitation cannot be resent with this address');
  const token = randomBytes(32).toString('base64url');
  const row = await transaction(ctx.pool, async client => {
    const resent = await (ctx.store ?? store).resendInvitation(client, found.row.tenant_id, found.row.id,
      { tokenHash: tokenDigest(token), emailHash, keyId: key.id, expiresAt: expiresAt() });
    if (resent) await audit(client, ctx, resent, 'resent');
    return resent;
  });
  return row ? ok(202, { ...invitationOut(row), token, entityId: row.id, acceptedEventType: 'iam.invitation.resent' })
    : err(409, 'INVITATION_NOT_PENDING', 'Invitation cannot be resent');
}

export const INVITATION_HANDLERS = { createInvitation, getInvitation, listInvitations, acceptInvitation, revokeInvitation, resendInvitation };
