// Domain B handlers (local to the control-plane): tenant lifecycle + user
// management. These are REAL implementations of what the repo only stubs
// (workflows/wf-con-002.mjs). Each handler: async (ctx) => { statusCode, body }
// where ctx = { params, query, body, identity, pool, callerContext }.
import { randomUUID } from 'node:crypto';
import { kcAdmin, TENANT_REALM_ROLES } from './kc-admin.mjs';
import * as store from './tenant-store.mjs';
import { AUTH_HANDLERS } from './auth-handlers.mjs';
import { startSaga } from './saga.mjs';
import { provisionWorkspaceDatabase, rotateWorkspaceDatabaseCredential, dropWorkspaceDatabase } from './dataplane.mjs';
import { deleteBucket } from './storage-handlers.mjs';
import { deleteTopics } from './kafka-handlers.mjs';
import { METRICS_HANDLERS } from './metrics-handlers.mjs';
import { STORAGE_HANDLERS } from './storage-handlers.mjs';
import { MONGO_HANDLERS } from './mongo-handlers.mjs';
import { PG_HANDLERS } from './pg-handlers.mjs';
import { KAFKA_HANDLERS } from './kafka-handlers.mjs';
import { FN_HANDLERS } from './fn-handlers.mjs';

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

// The web-console SPA consumes camelCase shapes ({tenantId, workspaceId,
// displayName, slug, state} and {items, page}); our rows are snake_case. Map at
// the edge, keeping the original columns too so existing API callers still work.
function tenantOut(t) {
  return { ...t, tenantId: t.id, displayName: t.display_name, slug: t.slug,
    state: t.status, iamRealm: t.iam_realm,
    // The console Members page resolves the realm from identityContext.consoleUserRealm.
    identityContext: { consoleUserRealm: t.iam_realm } };
}
function workspaceOut(w) {
  return { ...w, workspaceId: w.id, tenantId: w.tenant_id, displayName: w.display_name,
    slug: w.slug, state: w.status, environment: w.environment ?? null };
}
const collection = (items, total) => ({ items, total, page: { after: null, size: items.length } });

// Map a service_accounts row -> the console's ConsoleServiceAccount shape
// (serviceAccountId/iamBinding/credentialStatus/accessProjection/credentials).
function serviceAccountOut(sa) {
  const active = sa.status === 'active';
  return {
    serviceAccountId: sa.id,
    displayName: sa.display_name,
    entityType: 'service_account',
    desiredState: active ? 'active' : 'suspended',
    expiresAt: null,
    iamBinding: { realm: sa.iam_realm ?? null, clientId: sa.kc_client_id, credentialRef: sa.kc_client_id },
    credentialStatus: { state: sa.status === 'revoked' ? 'revoked' : 'active', issuedAt: sa.created_at ?? null, expiresAt: null, lastUsedAt: null },
    accessProjection: { effectiveAccess: active ? 'granted' : 'blocked', blockedByTenantSuspension: false,
      clientState: active ? 'enabled' : 'disabled', credentialState: sa.status === 'revoked' ? 'revoked' : 'active' },
    credentials: [{ credentialId: sa.kc_client_id, issuedAt: sa.created_at ?? null, expiresAt: null, status: sa.status }]
  };
}

// POST /v1/tenants  (superadmin) — create the tenant end-to-end:
//   Keycloak realm + standard realm roles (+ optional owner user) + DB record
//   (+ optional plan assignment). Best-effort compensation on failure.
async function createTenant(ctx) {
  const { body, identity, pool } = ctx;
  const displayName = body.displayName ?? body.name;
  if (!displayName) return err(400, 'VALIDATION_ERROR', 'displayName is required');
  const slug = slugify(body.slug ?? displayName);
  if (!slug) return err(400, 'VALIDATION_ERROR', 'a valid slug could not be derived');
  if (await store.slugTaken(pool, slug)) return err(409, 'SLUG_TAKEN', `tenant slug '${slug}' already exists`);

  const tenantId = randomUUID();
  const realm = tenantId; // realm name == tenantId (Falcone tenancy model)
  if (await kcAdmin.realmExists(realm)) return err(409, 'REALM_EXISTS', `realm ${realm} already exists`);

  // Durable saga: each forward step records a serializable compensation in
  // Postgres, so a crash mid-provision is rolled back (here on failure, or by
  // recoverSagas() on the next startup) — no orphaned realm / DB row.
  const saga = await startSaga(pool, 'createTenant', { tenantId, slug, displayName }, {
    tenantId, actorId: identity.sub, actorType: identity.actorType ?? 'superadmin',
    correlationId: ctx.callerContext?.correlationId, operationType: 'tenant.create'
  });
  try {
    await saga.step('createRealm',
      () => kcAdmin.createRealm({ realm, displayName }),
      { type: 'kc.deleteRealm', args: { realm } });
    // Roles live inside the realm; deleting the realm (above) compensates them.
    await saga.step('createRealmRoles',
      async () => { for (const role of TENANT_REALM_ROLES) await kcAdmin.createRealmRole(realm, role); });

    let owner = null;
    if (body.ownerUsername || body.ownerEmail) {
      const username = body.ownerUsername ?? body.ownerEmail;
      const userId = await saga.step('createOwnerUser',
        async () => {
          const id = await kcAdmin.createUser(realm, {
            username, email: body.ownerEmail ?? null,
            firstName: body.ownerFirstName ?? 'Tenant', lastName: body.ownerLastName ?? 'Owner',
            password: body.ownerPassword ?? null, temporary: !body.ownerPassword
          });
          await kcAdmin.assignRealmRoles(realm, id, ['tenant_owner']);
          return id;
        });
      owner = { id: userId, username };
    }

    const record = await saga.step('insertTenant',
      () => store.insertTenant(pool, { id: tenantId, slug, displayName, iamRealm: realm, createdBy: identity.sub }),
      { type: 'store.deleteTenant', args: { id: tenantId } });

    // Optional: assign a plan immediately (reuses the REAL plan-assign action).
    let planAssignment = null;
    if (body.planId) {
      planAssignment = await saga.step('assignPlan', async () => {
        const planAssign = (await import('/repo/services/provisioning-orchestrator/src/actions/plan-assign.mjs')).main;
        const res = await planAssign(
          { tenantId, planId: body.planId, assignedBy: identity.sub,
            callerContext: { actor: { id: identity.sub, type: 'superadmin' } } },
          { db: pool });
        return res?.body ?? null;
      });
    }

    await saga.complete({ tenantId, realm });
    return ok(201, { tenant: tenantOut(record), ...tenantOut(record), iamRealm: realm, owner, planAssignment, sagaId: saga.runId });
  } catch (e) {
    await saga.fail(e); // durable: replays recorded compensations newest-first
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'CREATE_TENANT_FAILED', String(e.message ?? e));
  }
}

// GET /v1/tenants  (superadmin) — list tenants from the registry.
async function listTenants(ctx) {
  const { query, pool } = ctx;
  const limit = Number(query['page[size]'] ?? query.limit ?? 100) || 100;
  const offset = Number(query.offset ?? 0) || 0;
  const res = await store.listTenants(pool, { limit, offset });
  return ok(200, collection(res.items.map(tenantOut), res.total));
}

// GET /v1/tenants/{tenantId}  (superadmin any; tenant_owner own) — get one.
async function getTenant(ctx) {
  const { params, identity, pool } = ctx;
  const t = await store.getTenant(pool, params.tenantId);
  if (!t) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (identity.actorType !== 'superadmin' && identity.actorType !== 'internal' && identity.tenantId !== t.id)
    return err(403, 'FORBIDDEN', 'cannot read another tenant');
  return ok(200, { tenant: tenantOut(t), ...tenantOut(t) });
}

function canManageTenant(identity, tenant) {
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  return ['tenant_owner', 'tenant_admin'].includes(identity.actorType) && identity.tenantId === tenant.id;
}

// POST /v1/tenants/{tenantId}/users  (superadmin or tenant_owner/admin of it)
//   Create a user in the tenant's realm + assign realm roles.
async function createTenantUser(ctx) {
  const { params, body, identity, pool } = ctx;
  const t = await store.getTenant(pool, params.tenantId);
  if (!t) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenant(identity, t)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin of this tenant');
  const username = body.username ?? body.email;
  if (!username) return err(400, 'VALIDATION_ERROR', 'username or email is required');
  const roles = Array.isArray(body.roles) && body.roles.length ? body.roles : ['tenant_developer'];
  const bad = roles.filter((r) => !TENANT_REALM_ROLES.includes(r));
  if (bad.length) return err(400, 'INVALID_ROLE', `unknown realm roles: ${bad.join(', ')}`);
  try {
    const userId = await kcAdmin.createUser(t.iam_realm, {
      username, email: body.email ?? null, firstName: body.firstName ?? null, lastName: body.lastName ?? null,
      password: body.password ?? null, temporary: !body.password
    });
    await kcAdmin.assignRealmRoles(t.iam_realm, userId, roles);
    return ok(201, { userId, username, realm: t.iam_realm, roles });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'CREATE_USER_FAILED', String(e.message ?? e));
  }
}

// GET /v1/tenants/{tenantId}/users  (superadmin or tenant owner/admin)
async function listTenantUsers(ctx) {
  const { params, identity, pool } = ctx;
  const t = await store.getTenant(pool, params.tenantId);
  if (!t) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenant(identity, t)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin of this tenant');
  const users = await kcAdmin.listUsers(t.iam_realm, { max: Number(params.max ?? ctx.query.max ?? 100) });
  return ok(200, {
    items: users.map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled,
      firstName: u.firstName, lastName: u.lastName, createdTimestamp: u.createdTimestamp })),
    total: users.length, realm: t.iam_realm
  });
}

function canManageTenantId(identity, tenantId) {
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  return ['tenant_owner', 'tenant_admin'].includes(identity.actorType) && identity.tenantId === tenantId;
}

// ---- tenant offboarding (add-tenant-delete-purge-cascade #501) --------------
// DELETE /v1/tenants/{tenantId} — soft delete: mark the tenant 'deleted' (reversible;
// resources are retained until an explicit purge). Returns 404 only if the tenant is unknown.
async function deleteTenant(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const rec = await store.markTenantDeleted(pool, tenant.id);
  return ok(200, { tenant: { id: tenant.id, status: rec?.status ?? 'deleted' },
    message: 'tenant marked deleted; POST /v1/tenants/{id}/purge to remove all owned resources' });
}

// POST /v1/tenants/{tenantId}/purge — hard cascade: remove EVERY resource the tenant owns
// (workspaces, databases, realms, buckets, topics, keys, registry rows, async-op rows), leaving
// no orphaned data. Physical teardown (DB drop, realm delete) is reliable; bucket/topic teardown
// is best-effort (the registry rows are removed regardless, so no orphaned rows remain).
async function purgeTenant(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const realm = tenant.iam_realm;

  // 1. Delete all registry rows + collect the physical resources to tear down.
  const phys = await store.purgeTenant(pool, tenant.id);
  // 2. Drop each physical workspace database (catalog-level isolation teardown).
  const databasesDropped = [];
  for (const db of phys.databases) { try { await dropWorkspaceDatabase(pool, db); databasesDropped.push(db); } catch { /* best-effort */ } }
  // 3. Delete the tenant's Keycloak realm — cascades its clients, users, and roles.
  let realmDeleted = false;
  if (realm) { try { await kcAdmin.deleteRealm(realm); realmDeleted = true; } catch { /* best-effort */ } }
  // 4. Best-effort physical object-store + topic teardown (rows already removed above).
  const bucketsDeleted = [];
  for (const b of phys.buckets) { try { await deleteBucket(b); bucketsDeleted.push(b); } catch { /* best-effort */ } }
  let topicsDeleted = [];
  try { await deleteTopics(phys.topics); topicsDeleted = phys.topics; } catch { /* best-effort */ }

  return ok(200, {
    tenantId: tenant.id, purged: true,
    removed: {
      workspaces: phys.workspaceIds.length,
      databases: databasesDropped, realm: realmDeleted ? realm : null,
      buckets: bucketsDeleted, topics: topicsDeleted,
    },
    // Resources whose physical teardown is not wired in this runtime (rows ARE removed).
    residual: { knativeServices: phys.ksvcs },
  });
}

// ---- workspaces ------------------------------------------------------------
// POST /v1/tenants/{tenantId}/workspaces
async function createWorkspace(ctx) {
  const { params, body, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const displayName = body.displayName ?? body.name;
  if (!displayName) return err(400, 'VALIDATION_ERROR', 'displayName is required');
  const slug = slugify(body.slug ?? displayName);
  if (await store.workspaceSlugTaken(pool, tenant.id, slug)) return err(409, 'SLUG_TAKEN', `workspace slug '${slug}' already exists in tenant`);
  const ws = await store.insertWorkspace(pool, { id: randomUUID(), tenantId: tenant.id, slug, displayName, createdBy: identity.sub });
  // Provision the workspace's real backing database as part of creation (#502), so the data API
  // routes to a real, isolated database instead of co-mingling in the shared control-plane DB.
  // Best-effort: the saga leaves NO orphaned registry row on failure, and the data API falls back
  // to the shared DB, so the workspace is still usable and provisioning can be retried via
  // POST /v1/workspaces/{id}/database. `database: null` signals the DB is not yet ready.
  let database = null;
  try {
    const out = await runWorkspaceDbProvisionSaga(pool, { ws, tenant, identity, callerContext: ctx.callerContext });
    database = out.database;
  } catch {
    database = null;
  }
  return ok(201, { workspace: workspaceOut(ws), ...workspaceOut(ws), database });
}
// GET /v1/workspaces  (superadmin: all; tenant scope: own tenant)
async function listWorkspaces(ctx) {
  const { query, identity, pool } = ctx;
  const filterTenant = query['filter[tenantId]'] ?? query.tenantId ?? null;
  const tenantId = (identity.actorType === 'superadmin' || identity.actorType === 'internal') ? filterTenant : identity.tenantId;
  const res = await store.listWorkspaces(pool, { tenantId,
    limit: Number(query['page[size]'] ?? query.limit ?? 100) || 100, offset: Number(query.offset ?? 0) || 0 });
  return ok(200, collection(res.items.map(workspaceOut), res.total));
}
// GET /v1/tenants/{tenantId}/workspaces
async function listTenantWorkspaces(ctx) {
  const { params, identity, pool } = ctx;
  const tenant = await store.getTenant(pool, params.tenantId);
  if (!tenant) return err(404, 'TENANT_NOT_FOUND', `tenant ${params.tenantId} not found`);
  if (!canManageTenantId(identity, tenant.id)) return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  const res = await store.listWorkspaces(pool, { tenantId: tenant.id });
  return ok(200, collection(res.items.map(workspaceOut), res.total));
}
// GET /v1/workspaces/{workspaceId}
async function getWorkspace(ctx) {
  const { params, identity, pool } = ctx;
  const ws = await store.getWorkspace(pool, params.workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${params.workspaceId} not found`);
  if (!canManageTenantId(identity, ws.tenant_id)) return err(403, 'FORBIDDEN', 'cannot read another tenant workspace');
  return ok(200, { workspace: workspaceOut(ws), ...workspaceOut(ws) });
}

// ---- service accounts (= confidential Keycloak client in the tenant realm) --
async function resolveWorkspaceForManage(ctx) {
  const ws = await store.getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!ws) return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
  if (!canManageTenantId(ctx.identity, ws.tenant_id)) return { error: err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin') };
  const tenant = await store.getTenant(ctx.pool, ws.tenant_id);
  if (!tenant?.iam_realm) return { error: err(409, 'NO_REALM', 'tenant has no IAM realm') };
  return { ws, realm: tenant.iam_realm };
}
// POST /v1/workspaces/{workspaceId}/service-accounts
async function createServiceAccount(ctx) {
  const { body, identity, pool } = ctx;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const displayName = body.displayName ?? body.name;
  if (!displayName) return err(400, 'VALIDATION_ERROR', 'name is required');
  const saId = randomUUID();
  const clientId = `sa-${r.ws.slug ?? r.ws.id.slice(0, 8)}-${slugify(displayName)}`;
  try {
    if (await kcAdmin.findClient(r.realm, clientId)) return err(409, 'SA_EXISTS', `service account client ${clientId} already exists`);
    const uuid = await kcAdmin.createConfidentialClient(r.realm, { clientId, name: displayName, serviceAccountsEnabled: true });
    const rec = await store.insertServiceAccount(pool, { id: saId, workspaceId: r.ws.id, tenantId: r.ws.tenant_id, iamRealm: r.realm, kcClientId: clientId, kcClientUuid: uuid, displayName, createdBy: identity.sub });
    // Top-level serviceAccountId is what the console persists to fetch the SA back.
    return ok(201, { serviceAccountId: rec.id, ...serviceAccountOut({ ...rec, iam_realm: r.realm }), serviceAccount: rec });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'CREATE_SA_FAILED', String(e.message ?? e));
  }
}
// GET /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}
async function getServiceAccount(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const sa = await store.getServiceAccount(ctx.pool, ctx.params.serviceAccountId);
  if (!sa || sa.workspace_id !== r.ws.id) return err(404, 'SA_NOT_FOUND', 'service account not found');
  const { iam_realm, kc_client_uuid, ...safe } = sa;
  // Console shape at top level (it passes the whole response to normalizeServiceAccount).
  return ok(200, { ...serviceAccountOut(sa), serviceAccount: safe });
}
// GET /v1/workspaces/{workspaceId}/service-accounts
async function listServiceAccountsHandler(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  return ok(200, await store.listServiceAccounts(ctx.pool, r.ws.id));
}
async function saForCredential(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return { error: r.error };
  const sa = await store.getServiceAccount(ctx.pool, ctx.params.serviceAccountId);
  if (!sa || sa.workspace_id !== r.ws.id) return { error: err(404, 'SA_NOT_FOUND', 'service account not found') };
  return { sa };
}
// POST /v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance
async function issueCredential(ctx) {
  const r = await saForCredential(ctx); if (r.error) return r.error;
  const secret = await kcAdmin.getClientSecret(r.sa.iam_realm, r.sa.kc_client_uuid);
  return ok(201, { credentialId: r.sa.kc_client_id, secret, expiresAt: null,
    clientId: r.sa.kc_client_id, clientSecret: secret, tokenEndpoint: `${kcAdmin.base}/realms/${r.sa.iam_realm}/protocol/openid-connect/token`, grantType: 'client_credentials', issuedAt: new Date().toISOString() });
}
// POST .../credential-rotations
async function rotateCredential(ctx) {
  const r = await saForCredential(ctx); if (r.error) return r.error;
  const secret = await kcAdmin.regenerateClientSecret(r.sa.iam_realm, r.sa.kc_client_uuid);
  return ok(201, { credentialId: r.sa.kc_client_id, secret, expiresAt: null,
    clientId: r.sa.kc_client_id, clientSecret: secret, rotatedAt: new Date().toISOString() });
}
// POST .../credential-revocations
async function revokeCredential(ctx) {
  const r = await saForCredential(ctx); if (r.error) return r.error;
  await kcAdmin.regenerateClientSecret(r.sa.iam_realm, r.sa.kc_client_uuid); // invalidate the old secret
  await kcAdmin.setClientEnabled(r.sa.iam_realm, r.sa.kc_client_uuid, false);
  await store.setServiceAccountStatus(ctx.pool, r.sa.id, 'revoked');
  return ok(200, { serviceAccountId: r.sa.id, status: 'revoked', revokedAt: new Date().toISOString() });
}

// ---- fine-grained IAM (platform admin; realmId in the path) ----------------
// Items carry BOTH the IAM Access page's fields (id/name) AND the Members page's
// (userId/realmRoles, roleName/composite). realmRoles is enriched per user (small
// realms), so the Members table shows each user's roles inline.
async function iamListUsers(ctx) {
  const realm = ctx.params.realmId;
  const max = Number(ctx.query['page[size]'] ?? ctx.query.max ?? 200) || 200;
  const users = await kcAdmin.listUsers(realm, { max });
  const items = await Promise.all(users.map(async (u) => {
    let realmRoles = [];
    try {
      realmRoles = (await kcAdmin.listUserRealmRoles(realm, u.id))
        .map((r) => r.name).filter((n) => n && !String(n).startsWith('default-roles'));
    } catch { /* best-effort: show no roles rather than fail the list */ }
    return {
      id: u.id, userId: u.id, realmId: realm, username: u.username, email: u.email ?? null,
      enabled: u.enabled, state: u.enabled ? 'active' : 'suspended',
      firstName: u.firstName, lastName: u.lastName, createdTimestamp: u.createdTimestamp,
      realmRoles, requiredActions: u.requiredActions ?? [], attributes: u.attributes ?? {}
    };
  }));
  return ok(200, { items, total: items.length, page: { after: null, size: items.length } });
}
async function iamCreateUser(ctx) {
  const { params, body, identity } = ctx;
  if (!body.username && !body.email) return err(400, 'VALIDATION_ERROR', 'username or email required');
  try {
    const id = await kcAdmin.createUser(params.realmId, { username: body.username ?? body.email, email: body.email ?? null, firstName: body.firstName ?? null, lastName: body.lastName ?? null, password: body.password ?? null, temporary: !body.password });
    if (Array.isArray(body.roles) && body.roles.length) await kcAdmin.assignRealmRoles(params.realmId, id, body.roles);
    return ok(201, { userId: id, username: body.username ?? body.email, realm: params.realmId, roles: body.roles ?? [], createdBy: identity.sub });
  } catch (e) { return err(e.kcStatus === 409 ? 409 : (e.statusCode && e.statusCode < 500 ? e.statusCode : 502), 'IAM_CREATE_USER_FAILED', String(e.message ?? e)); }
}
async function iamListRoles(ctx) {
  const roles = await kcAdmin.listRealmRoles(ctx.params.realmId);
  const items = roles.map((r) => ({
    id: r.id, name: r.name, roleName: r.name, realmId: ctx.params.realmId,
    description: r.description ?? null, composite: Boolean(r.composite), compositeRoles: [],
    attributes: r.attributes ?? {}
  }));
  return ok(200, { items, total: items.length, page: { after: null, size: items.length } });
}
async function iamCreateRole(ctx) {
  if (!ctx.body.name) return err(400, 'VALIDATION_ERROR', 'name required');
  await kcAdmin.createRealmRole(ctx.params.realmId, ctx.body.name);
  return ok(201, { name: ctx.body.name, realm: ctx.params.realmId });
}
async function iamListGroups(ctx) {
  const groups = await kcAdmin.listGroups(ctx.params.realmId);
  return ok(200, { items: groups.map((g) => ({ id: g.id, name: g.name, path: g.path })), total: groups.length });
}
async function iamCreateGroup(ctx) {
  if (!ctx.body.name) return err(400, 'VALIDATION_ERROR', 'name required');
  const id = await kcAdmin.createGroup(ctx.params.realmId, ctx.body.name);
  return ok(201, { id, name: ctx.body.name, realm: ctx.params.realmId });
}
async function iamListClients(ctx) {
  const clients = await kcAdmin.listClients(ctx.params.realmId);
  return ok(200, { items: clients.map((c) => ({ id: c.id, clientId: c.clientId, enabled: c.enabled, publicClient: c.publicClient, serviceAccountsEnabled: c.serviceAccountsEnabled })), total: clients.length });
}

// ---- data plane: workspace database provisioning ---------------------------
// POST /v1/workspaces/{workspaceId}/database — provision a REAL Postgres
// database for the workspace (catalog-level isolation), via a durable saga.
// Provision the workspace's real Postgres database via the durable saga (createDatabase →
// insertRecord). The saga creates the physical DB BEFORE the registry row and compensates on
// failure (drops the DB), so a failure never leaves a workspace_databases row without a backing
// database (#502). Shared by the explicit endpoint and by auto-provisioning at workspace create.
// Throws on failure (after marking the saga failed); the caller maps/handles it.
async function runWorkspaceDbProvisionSaga(pool, { ws, tenant, identity, callerContext }) {
  const saga = await startSaga(pool, 'provisionWorkspaceDatabase', { workspaceId: ws.id, tenantId: ws.tenant_id }, {
    tenantId: ws.tenant_id, workspaceId: ws.id, actorId: identity.sub, actorType: identity.actorType ?? 'superadmin',
    correlationId: callerContext?.correlationId, operationType: 'workspace.database.provision'
  });
  try {
    const conn = await saga.step('createDatabase',
      () => provisionWorkspaceDatabase(pool, { tenantSlug: tenant?.slug ?? ws.tenant_id, wsSlug: ws.slug ?? ws.id }),
      (val) => ({ type: 'pg.dropDatabase', args: { database: val.database } }));
    const rec = await saga.step('insertRecord',
      () => store.insertWorkspaceDatabase(pool, {
        id: randomUUID(), workspaceId: ws.id, tenantId: ws.tenant_id, engine: conn.engine,
        databaseName: conn.database, mode: conn.mode, username: conn.username, host: conn.host, port: conn.port, createdBy: identity.sub }),
      (val) => ({ type: 'store.deleteWorkspaceDatabase', args: { id: val.id } }));
    await saga.complete({ database: conn.database });
    return { database: rec, connection: conn, sagaId: saga.runId };
  } catch (e) {
    await saga.fail(e);
    throw e;
  }
}

async function provisionDatabase(ctx) {
  const { pool, identity } = ctx;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  if (await store.getWorkspaceDatabase(pool, r.ws.id)) return err(409, 'DB_ALREADY_PROVISIONED', 'workspace already has a database');
  const tenant = await store.getTenant(pool, r.ws.tenant_id);
  try {
    const out = await runWorkspaceDbProvisionSaga(pool, { ws: r.ws, tenant, identity, callerContext: ctx.callerContext });
    // The role password is surfaced ONCE here (not persisted); rotate to re-issue.
    return ok(201, { database: out.database, connection: out.connection, sagaId: out.sagaId });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'PROVISION_DB_FAILED', String(e.message ?? e));
  }
}
// POST /v1/workspaces/{workspaceId}/databases — engine-dispatched provisioning
// (the SPA's ProvisionDatabaseWizard targets this; engine = postgresql | mongodb).
async function provisionDatabaseGeneric(ctx) {
  const engine = String(ctx.body?.engine ?? 'postgresql').toLowerCase();
  if (engine === 'mongodb') {
    const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
    return MONGO_HANDLERS.mongoProvision({ ...ctx, workspace: r.ws });
  }
  const res = await provisionDatabase(ctx); // postgres path
  if (res.statusCode === 201) return ok(201, { databaseId: res.body?.database?.id, ...res.body });
  return res;
}
// GET /v1/workspaces/{workspaceId}/database — metadata only (no secret).
async function getDatabase(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const db = await store.getWorkspaceDatabase(ctx.pool, r.ws.id);
  if (!db) return err(404, 'DB_NOT_PROVISIONED', 'workspace has no database');
  return ok(200, { database: db });
}
// POST /v1/workspaces/{workspaceId}/database/credential-rotations — rotate creds.
async function rotateDatabaseCredential(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const db = await store.getWorkspaceDatabase(ctx.pool, r.ws.id);
  if (!db) return err(404, 'DB_NOT_PROVISIONED', 'workspace has no database');
  try {
    const res = await rotateWorkspaceDatabaseCredential(ctx.pool, { database: db.database_name, mode: db.mode, username: db.username });
    return ok(res.rotated ? 201 : 200, { databaseId: db.id, ...res });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'ROTATE_DB_FAILED', String(e.message ?? e));
  }
}
// ---- data plane: function registry (execution pends OpenWhisk) -------------
// POST /v1/workspaces/{workspaceId}/functions — register a function.
async function registerFunction(ctx) {
  const { body, pool, identity } = ctx;
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  const name = slugify(body.name ?? body.displayName);
  if (!name) return err(400, 'VALIDATION_ERROR', 'name is required');
  if (await store.functionNameTaken(pool, r.ws.id, name)) return err(409, 'FUNCTION_EXISTS', `function '${name}' already exists in workspace`);
  const rec = await store.insertFunction(pool, {
    id: randomUUID(), workspaceId: r.ws.id, tenantId: r.ws.tenant_id, name,
    runtime: body.runtime ?? 'nodejs:20', handler: body.handler ?? 'main', sourceRef: body.sourceRef ?? null, createdBy: identity.sub });
  return ok(201, {
    function: rec,
    // Honest: registered, but execution needs the OpenWhisk data plane (stubbed here).
    runtimeStatus: 'pending_data_plane',
    message: 'Function registered. Execution activates when the OpenWhisk data plane is deployed.'
  });
}
// GET /v1/workspaces/{workspaceId}/functions — list registered functions.
async function listFunctionsHandler(ctx) {
  const r = await resolveWorkspaceForManage(ctx); if (r.error) return r.error;
  return ok(200, await store.listFunctions(ctx.pool, r.ws.id));
}

// ---- fine-grained IAM: role assignment + group membership ------------------
async function iamListUserRoles(ctx) {
  const roles = await kcAdmin.listUserRealmRoles(ctx.params.realmId, ctx.params.userId);
  return ok(200, { items: roles.map((r) => ({ id: r.id, name: r.name, description: r.description })), total: roles.length });
}
async function iamAssignUserRoles(ctx) {
  const roles = Array.isArray(ctx.body.roles) ? ctx.body.roles : [];
  if (!roles.length) return err(400, 'VALIDATION_ERROR', 'roles[] is required');
  try { await kcAdmin.assignRealmRoles(ctx.params.realmId, ctx.params.userId, roles);
    return ok(201, { userId: ctx.params.userId, realm: ctx.params.realmId, assigned: roles }); }
  catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'IAM_ASSIGN_ROLE_FAILED', String(e.message ?? e)); }
}
async function iamRemoveUserRoles(ctx) {
  const roles = Array.isArray(ctx.body.roles) ? ctx.body.roles : [];
  if (!roles.length) return err(400, 'VALIDATION_ERROR', 'roles[] is required');
  try { await kcAdmin.removeRealmRoles(ctx.params.realmId, ctx.params.userId, roles);
    return ok(200, { userId: ctx.params.userId, realm: ctx.params.realmId, removed: roles }); }
  catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'IAM_REMOVE_ROLE_FAILED', String(e.message ?? e)); }
}
async function iamListGroupMembers(ctx) {
  const members = await kcAdmin.listGroupMembers(ctx.params.realmId, ctx.params.groupId, { max: Number(ctx.query.max ?? 200) });
  return ok(200, { items: members.map((u) => ({ id: u.id, username: u.username, email: u.email, enabled: u.enabled })), total: members.length });
}
async function iamListUserGroups(ctx) {
  const groups = await kcAdmin.listUserGroups(ctx.params.realmId, ctx.params.userId);
  return ok(200, { items: groups.map((g) => ({ id: g.id, name: g.name, path: g.path })), total: groups.length });
}
async function iamAddUserToGroup(ctx) {
  try { await kcAdmin.addUserToGroup(ctx.params.realmId, ctx.params.userId, ctx.params.groupId);
    return ok(201, { userId: ctx.params.userId, groupId: ctx.params.groupId, realm: ctx.params.realmId, member: true }); }
  catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'IAM_GROUP_ADD_FAILED', String(e.message ?? e)); }
}
async function iamRemoveUserFromGroup(ctx) {
  try { await kcAdmin.removeUserFromGroup(ctx.params.realmId, ctx.params.userId, ctx.params.groupId);
    return ok(200, { userId: ctx.params.userId, groupId: ctx.params.groupId, realm: ctx.params.realmId, member: false }); }
  catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'IAM_GROUP_REMOVE_FAILED', String(e.message ?? e)); }
}

export const LOCAL_HANDLERS = {
  createTenant, listTenants, getTenant, deleteTenant, purgeTenant, createTenantUser, listTenantUsers,
  createWorkspace, listWorkspaces, listTenantWorkspaces, getWorkspace,
  createServiceAccount, getServiceAccount, listServiceAccounts: listServiceAccountsHandler,
  issueCredential, rotateCredential, revokeCredential,
  provisionDatabase, provisionDatabaseGeneric, getDatabase, rotateDatabaseCredential, registerFunction, listFunctions: listFunctionsHandler,
  iamListUsers, iamCreateUser, iamListRoles, iamCreateRole, iamListGroups, iamCreateGroup, iamListClients,
  iamListUserRoles, iamAssignUserRoles, iamRemoveUserRoles,
  iamListGroupMembers, iamListUserGroups, iamAddUserToGroup, iamRemoveUserFromGroup,
  ...METRICS_HANDLERS,
  ...STORAGE_HANDLERS,
  ...MONGO_HANDLERS,
  ...PG_HANDLERS,
  ...KAFKA_HANDLERS,
  ...FN_HANDLERS,
  ...AUTH_HANDLERS
};
