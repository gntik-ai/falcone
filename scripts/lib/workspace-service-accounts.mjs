import { kcAdmin as defaultKcAdmin, CONTEXT_SCOPE_CLAIM_MAPPERS, WORKSPACE_ID_MAPPER,
  KEYCLOAK_ADMIN_SAFE_MESSAGE, isWorkspaceIdMapper, isWorkspaceClaimMapper,
  isServiceAccountRoleMapper, serviceAccountAllowedRoles } from '../../apps/control-plane/kc-admin.mjs';

export const ROLE = 'workspace_service_account';
export const ROLLBACK_MARKER = 'in-falcone.workspace-rollback';
export const restoredMarker = workspaceId => `restored:${workspaceId}`;
export class MigrationConflict extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireState(condition, code) {
  if (!condition) throw new MigrationConflict(code);
}
export function safeFailure(error) {
  return error instanceof MigrationConflict ? error.code : KEYCLOAK_ADMIN_SAFE_MESSAGE;
}
export function parseArgs(argv = []) {
  let dryRun = true;
  for (const arg of argv) {
    if (arg === '--apply') dryRun = false;
    else if (arg === '--dry-run') dryRun = true;
    else throw new MigrationConflict('unsupported-option');
  }
  return { dryRun };
}

const REGISTRY_SQL = `SELECT sa.*, w.id AS joined_workspace_id, w.tenant_id AS workspace_tenant_id,
  t.id AS joined_tenant_id, t.iam_realm AS tenant_realm
  FROM service_accounts sa
  LEFT JOIN workspaces w ON w.id = sa.workspace_id
  LEFT JOIN tenants t ON t.id = sa.tenant_id`;

export function verifyRegistry(row) {
  requireState(row?.status === 'active', 'inactive-registry-row');
  requireState(row.joined_workspace_id && row.joined_workspace_id === row.workspace_id
    && row.workspace_tenant_id === row.tenant_id, 'workspace-registry-mismatch');
  requireState(row.joined_tenant_id && row.joined_tenant_id === row.tenant_id
    && row.tenant_realm && row.tenant_realm === row.iam_realm, 'tenant-realm-mismatch');
  requireState(row.kc_client_uuid && row.kc_client_id, 'client-registry-mismatch');
}
function matches(mapper, definition) {
  return ['name', 'protocol', 'protocolMapper'].every(key => mapper?.[key] === definition[key])
    && Object.keys(mapper.config ?? {}).length === Object.keys(definition.config).length
    && Object.entries(definition.config).every(([key, value]) => mapper.config?.[key] === value);
}
export const isBinding = isWorkspaceIdMapper;
function verifyOtherMapper(mapper) {
  requireState(!isServiceAccountRoleMapper(mapper), 'conflicting-role-source');
}
export async function inspect(kc, row, { rollback = false } = {}) {
  verifyRegistry(row);
  const realm = row.tenant_realm;
  const uuid = row.kc_client_uuid;
  const client = await kc.getClient(realm, uuid);
  requireState(client?.id === uuid && client.clientId === row.kc_client_id
    && client.attributes?.['in-falcone.kind'] === 'service-account'
    && client.serviceAccountsEnabled === true && typeof client.enabled === 'boolean', 'client-registry-mismatch');
  const mappers = await kc.listClientMappers(realm, uuid);
  const binding = mappers.filter(mapper => isWorkspaceClaimMapper(mapper) || mapper.name === WORKSPACE_ID_MAPPER.name);
  requireState(binding.length <= 1 && binding.every(mapper => isBinding(mapper, row.joined_workspace_id)), 'conflicting-client-claim-source');
  mappers.forEach(verifyOtherMapper);
  const detach = [];
  for (const [type, scopes] of [
    ['default', await kc.listClientDefaultScopes(realm, uuid)],
    ['optional', await kc.listClientOptionalScopes(realm, uuid)],
  ]) {
    for (const scope of scopes) {
      const sources = await kc.listScopeMappers(realm, scope.id);
      sources.forEach(verifyOtherMapper);
      if (scope.name === 'workspace-context') {
        requireState(sources.length === 1 && matches(sources[0], CONTEXT_SCOPE_CLAIM_MAPPERS['workspace-context'][0])
          && sources[0].consentRequired !== true, 'noncanonical-workspace-context');
        detach.push({ type, id: scope.id });
      } else requireState(!sources.some(isWorkspaceClaimMapper), 'conflicting-scope-claim-source');
    }
  }
  const user = await kc.getServiceAccountUser(realm, uuid);
  requireState(user?.id, 'missing-service-account-user');
  const roles = (await kc.listEffectiveRealmRoles(realm, user.id)).map(role => role.name);
  const complete = binding.length === 1 && detach.length === 0 && roles.includes(ROLE);
  // Stored or inherited attributes are not evidence of emitted claims. Forward
  // migration disables the client until only the registry's hardcoded W remains.
  // A failed forward run can leave the canonical legacy scope attached. Rollback
  // keeps it and W intact while disabling the client; it never emits a new token.
  if (rollback) requireState(binding.length === 1, 'rollback-requires-canonical-binding');
  const marker = client.attributes?.[ROLLBACK_MARKER];
  requireState(marker == null || marker === row.joined_workspace_id
    || marker === restoredMarker(row.joined_workspace_id), 'rollback-marker-mismatch');
  const recover = marker === row.joined_workspace_id;
  const allowed = serviceAccountAllowedRoles(realm);
  const plan = rollback ? [client.enabled || recover ? 'disable-with-marker' : 'keep-disabled', 'invalidate-credentials', 'remove-workspace-role'] : complete && !recover ? [] : [
    ...(client.enabled ? ['disable-client'] : []),
    ...(!binding.length ? ['install-workspace-mapper'] : []),
    'verify-workspace-mapper',
    ...(detach.length ? ['detach-workspace-context'] : []),
    'verify-claim-sources',
    ...(!roles.includes(ROLE) ? ['ensure-workspace-role', 'assign-workspace-role'] : []),
    'verify-effective-roles',
    ...(recover ? ['enable-marked-client'] : client.enabled ? ['restore-enabled-client'] : []),
  ];
  return { row, realm, uuid, client, user, roles, detach, complete,
    report: { serviceAccountId: row.id, realm, clientId: row.kc_client_id, workspaceId: row.joined_workspace_id,
      plan, previousRoles: roles, extraRoles: roles.filter(role => !allowed.has(role)) } };
}

// Inspect before writing. Terminal rows are report-only and remain in the inventory
// so their registered clients cannot be mistaken for unregistered clients.
export async function preflight({ pool, kcAdmin = defaultKcAdmin, rollback = false }) {
  const inspected = [];
  const failed = [];
  let blocked = false;
  let rows, tenants;
  try {
    ({ rows } = await pool.query(`${REGISTRY_SQL} ORDER BY sa.id`));
    tenants = (await pool.query('SELECT id, iam_realm FROM tenants WHERE iam_realm IS NOT NULL ORDER BY id')).rows;
  } catch (error) {
    return { inspected, blocked: true, failed: [{ phase: 'registry', reason: safeFailure(error) }] };
  }
  for (const row of rows) {
    if (row.status !== 'active') {
      failed.push({ serviceAccountId: row.id, reason: 'inactive-registry-row' });
      continue;
    }
    try {
      requireState(rows.filter(other => other.iam_realm === row.iam_realm
        && (other.kc_client_uuid === row.kc_client_uuid || other.kc_client_id === row.kc_client_id)).length === 1, 'duplicate-registry-client');
      inspected.push(await inspect(kcAdmin, row, { rollback }));
    } catch (error) {
      blocked = true;
      failed.push({ serviceAccountId: row.id, reason: safeFailure(error) });
    }
  }
  for (const tenant of tenants) {
    try {
      for (const client of await kcAdmin.listClients(tenant.iam_realm)) {
        if (client.attributes?.['in-falcone.kind'] !== 'service-account') continue;
        requireState(rows.some(row => row.tenant_id === tenant.id && row.iam_realm === tenant.iam_realm
          && row.kc_client_uuid === client.id && row.kc_client_id === client.clientId), 'client-missing-from-registry');
      }
    } catch (error) {
      blocked = true;
      failed.push({ realm: tenant.iam_realm, reason: safeFailure(error) });
    }
  }
  return { inspected, failed, blocked };
}

// Stabilize registry identity/status across the KC migration. Operators pause other
// IAM writes in the window; re-read joins under the lock rather than trusting the plan.
export async function withRegistryLock(pool, row, action) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(`${REGISTRY_SQL} WHERE sa.id = $1 FOR UPDATE OF sa`, [row.id]);
    const fresh = rows[0];
    verifyRegistry(fresh);
    requireState(['workspace_id', 'tenant_id', 'iam_realm', 'kc_client_id', 'kc_client_uuid'].every(key => fresh[key] === row[key]), 'registry-changed');
    const result = await action(fresh, db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* Do not emit database errors. */ }
    throw error;
  } finally { db.release(); }
}

export async function verifyDisabled(kc, state) {
  requireState((await kc.getClient(state.realm, state.uuid))?.enabled === false, 'client-not-disabled');
}

export async function cliMain(run, argv) {
  parseArgs(argv);
  return withCliPool(run, argv);
}

export async function withCliPool(run, argv) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PROVISIONING_DB_URL ?? process.env.DATABASE_URL });
  try { process.exitCode = (await run({ argv, pool })).exitCode; }
  finally { await pool.end(); }
}
