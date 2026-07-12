/**
 * DocumentDB per-tenant identity applier (FerretDB migration, issue #458).
 * @module appliers/documentdb-identity-applier
 *
 * Provisions, rotates, and revokes a per-tenant DocumentDB credential by issuing the
 * MongoDB **wire-protocol** `createUser` / `updateUser` / `dropUser` / `usersInfo`
 * commands through the FerretDB gateway. ADR-14 (add-ferretdb-adr-spike) confirmed that
 * `db.runCommand({createUser, roles})` over the wire protocol provisions a real Postgres
 * LOGIN role (non-superuser, non-BYPASSRLS) in the postgres-documentdb backend.
 *
 * This is NOT Postgres DDL: it issues no `CREATE USER` / `GRANT ALL ON DATABASE`, and it
 * does not extend `postgres-applier.mjs` (which manages only schemas/tables/views/
 * extensions/grants and has no identity logic). The per-tenant Mongo "database"
 * `falcone_doc_{tenantId}` is a DocumentDB **logical namespace** inside one shared
 * Postgres database, NOT a Postgres-database-per-tenant.
 *
 * ISOLATION BOUNDARY — READ THIS: the per-tenant credential is for **least-privilege
 * auth and per-tenant audit trail ONLY**. ADR-14 *disproved* per-database role scoping at
 * this engine version: a user with readWrite on `tenant_a` could still read `tenant_b`.
 * The AUTHORITATIVE tenant-isolation boundary remains the application-layer scoping in
 * `packages/adapters/src/mongodb-data-api.mjs` (`applyTenantScopeToFilter` /
 * `injectTenantIntoDocument`), which is unchanged by the engine swap and MUST stay active
 * on every data-api code path. Do not present this credential as a DB-level isolation
 * boundary. (Optional defense-in-depth: RLS on the `documentdb_data` tables — see the
 * change's design D7 and `packages/adapters/src/tenant-rls-context.mjs`.)
 */

import { randomBytes } from 'node:crypto';

/** Error code thrown when provisioning cannot complete (fail-closed; Design D5). */
export const DOCUMENTDB_IDENTITY_PROVISION_FAILED = 'DOCUMENTDB_IDENTITY_PROVISION_FAILED';

const DOMAIN_KEY = 'documentdb_identity';
const DEFAULT_ROLE = 'readWrite';

/**
 * Per-tenant logical namespace / credential name. Sanitised to a Postgres/Mongo-safe
 * identifier: lowercase, `[a-z0-9_]`, dashes -> underscores. Stable for a given tenantId.
 * @param {string} tenantId
 * @returns {string}
 */
export function documentdbUserName(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('documentdbUserName: tenantId must be a non-empty string');
  }
  const safe = tenantId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!safe) throw new Error(`documentdbUserName: tenantId '${tenantId}' has no usable characters`);
  return `falcone_doc_${safe}`;
}

/** The per-tenant logical namespace (Mongo "database"). Same value as the user name. */
export function documentdbNamespace(tenantId) {
  return documentdbUserName(tenantId);
}

/**
 * Generate a strong random password (URL-safe, no provider-shaped prefix so commits are
 * not blocked by GitHub push protection). 36 bytes -> 48 base64url chars.
 * @returns {string}
 */
export function generateCredentialPassword() {
  return randomBytes(36).toString('base64url');
}

/**
 * Build a wire-protocol runner from an injected MongoDB driver client. Mirrors the
 * injectable-client pattern in `mongo-applier.mjs` (`credentials.mongoClient` / `getDb`).
 * @param {Object} credentials
 * @returns {(dbName: string, command: Object) => Promise<Object>}
 */
function resolveRunCommand(credentials = {}) {
  if (typeof credentials.runCommand === 'function') return credentials.runCommand;
  const mongoClient = credentials.mongoClient ?? null;
  return (dbName, command) => {
    if (!mongoClient) throw new Error('No MongoDB wire-protocol client configured for DocumentDB identity provisioning');
    return mongoClient.db(dbName).command(command);
  };
}

/**
 * @returns {Promise<boolean>} true if a credential already exists for the user.
 */
async function userExists(runCommand, dbName, userName) {
  try {
    const info = await runCommand(dbName, { usersInfo: userName });
    return Array.isArray(info?.users) && info.users.length > 0;
  } catch {
    // usersInfo failure is treated as "unknown -> not present"; provisioning will surface
    // any real error from createUser itself (fail-closed).
    return false;
  }
}

/**
 * Provision a per-tenant DocumentDB credential (idempotent). On first provision it issues
 * `createUser` over the wire protocol, writes the password to the secret store, and
 * returns a ONE-TIME secret envelope. Re-provision of an existing credential is a no-op
 * (no duplicate createUser, no password overwrite, no new envelope).
 *
 * Fail-closed (Design D5): any createUser failure throws `DOCUMENTDB_IDENTITY_PROVISION_FAILED`
 * — the caller MUST NOT fall through to the shared MONGO_URI credential.
 *
 * @param {string} tenantId
 * @param {Object} [opts]
 * @param {Object} [opts.credentials] - { runCommand } or { mongoClient }
 * @param {(sql:string)=>Promise<any>} [opts.pgQuery] - Postgres query runner on the
 *   bootstrap/superuser DSN, used to demote the engine-created role from SUPERUSER to a
 *   least-privilege login role (the engine creates superusers; FerretDB can't ALTER ROLE).
 *   Strongly recommended — without it the credential is NOT least-privilege.
 * @param {{ put: (args:{tenantId:string,path:string,value:string,version:number}) => Promise<{name:string,path:string}> }} [opts.secretStore]
 * @param {(event: Object) => void|Promise<void>} [opts.emitAudit]
 * @param {() => string} [opts.generatePassword]
 * @param {string} [opts.role] - Mongo role granted on the per-tenant namespace
 * @param {boolean} [opts.dryRun]
 * @param {Console} [opts.log]
 * @returns {Promise<{ provisioned: boolean, userName: string, namespace: string, credentialVersion: number, secretRef: {name:string,path:string}|null, oneTimeCredential: {userName:string,password:string,namespace:string}|null }>}
 */
export async function provisionTenantIdentity(tenantId, opts = {}) {
  const { credentials = {}, secretStore = null, emitAudit, role = DEFAULT_ROLE, dryRun = false, log = console } = opts;
  const generatePassword = opts.generatePassword ?? generateCredentialPassword;
  const userName = documentdbUserName(tenantId);
  const namespace = documentdbNamespace(tenantId);
  const runCommand = resolveRunCommand(credentials);

  if (await userExists(runCommand, namespace, userName)) {
    log?.info?.(`[documentdb-identity] credential for ${userName} already exists; skipping (idempotent)`);
    return { provisioned: false, userName, namespace, credentialVersion: 1, secretRef: null, oneTimeCredential: null };
  }

  if (dryRun) {
    return { provisioned: false, userName, namespace, credentialVersion: 1, secretRef: null, oneTimeCredential: null };
  }

  const password = generatePassword();
  try {
    await runCommand(namespace, {
      createUser: userName,
      pwd: password,
      roles: [{ role, db: namespace }],
    });
  } catch (err) {
    const error = new Error(`${DOCUMENTDB_IDENTITY_PROVISION_FAILED}: createUser for tenant '${tenantId}' failed: ${err.message}`);
    error.code = DOCUMENTDB_IDENTITY_PROVISION_FAILED;
    error.cause = err;
    throw error;
  }

  // LEAST-PRIVILEGE ENFORCEMENT (kind live run, #458): at postgres-documentdb
  // 0.107.0-ferretdb-2.7.0, wire-protocol `createUser` provisions a Postgres **SUPERUSER**
  // role (verified live: `\du` shows `Superuser`), which contradicts the spec's
  // non-superuser/non-BYPASSRLS requirement and would let the role bypass RLS entirely.
  // FerretDB exposes no `ALTER ROLE`, so we demote over an injected Postgres connection
  // (the bootstrap/superuser DSN). Fail-closed: if demotion fails, the credential is
  // unsafe → throw (D5). If no pgQuery is injected, we cannot guarantee least privilege.
  const pgQuery = opts.pgQuery ?? credentials.pgQuery;
  const leastPrivilegeEnforced = await enforceLeastPrivilege(pgQuery, userName, tenantId, log);

  const credentialVersion = 1;
  const secretRef = await persistCredential({ secretStore, tenantId, userName, password, credentialVersion });

  await safeEmitAudit(emitAudit, {
    eventCategory: 'credential_rotation',
    eventType: 'documentdb_identity_provisioned',
    tenantId,
    subject: userName,
    namespace,
    credentialVersion,
    rotationReason: 'tenant_onboarding',
  });

  // The plaintext password is delivered exactly once here and never persisted to the
  // relational DB (only the secret-store reference is stored downstream).
  return {
    provisioned: true,
    userName,
    namespace,
    credentialVersion,
    secretRef,
    leastPrivilegeEnforced,
    oneTimeCredential: { userName, password, namespace },
  };
}

/**
 * Demote the engine-created role to a least-privilege login role over an injected
 * Postgres connection. Returns true when enforced, false when no pgQuery is injected
 * (caller is warned). Throws DOCUMENTDB_IDENTITY_PROVISION_FAILED if demotion errors
 * (a superuser credential must never be handed out — fail-closed).
 * @param {(sql:string)=>Promise<any>|undefined} pgQuery
 */
async function enforceLeastPrivilege(pgQuery, userName, tenantId, log) {
  if (typeof pgQuery !== 'function') {
    log?.warn?.(
      `[documentdb-identity] no pgQuery injected; cannot demote '${userName}' from the ` +
      `engine-default SUPERUSER to a least-privilege role. The credential is NOT least-privilege.`,
    );
    return false;
  }
  // userName is `falcone_doc_<[a-z0-9_]+>` (sanitised), safe to interpolate as an identifier.
  try {
    await pgQuery(`ALTER ROLE "${userName}" NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    return true;
  } catch (err) {
    const error = new Error(`${DOCUMENTDB_IDENTITY_PROVISION_FAILED}: least-privilege demotion of '${userName}' (tenant '${tenantId}') failed: ${err.message}`);
    error.code = DOCUMENTDB_IDENTITY_PROVISION_FAILED;
    error.cause = err;
    throw error;
  }
}

/**
 * Rotate the per-tenant credential: issue `updateUser` with a new password, update the
 * secret store, emit a `credential_rotation` audit event, and deliver the new credential
 * once. Fail-closed on engine error.
 *
 * @param {string} tenantId
 * @param {Object} [opts] - same shape as provisionTenantIdentity, plus:
 * @param {number} [opts.currentVersion] - prior credentialVersion (defaults to 1)
 * @param {string} [opts.rotationReason]
 * @returns {Promise<{ rotated: boolean, userName: string, credentialVersion: number, secretRef: {name:string,path:string}|null, oneTimeCredential: {userName:string,password:string,namespace:string} }>}
 */
export async function rotateTenantIdentityCredential(tenantId, opts = {}) {
  const { credentials = {}, secretStore = null, emitAudit, currentVersion = 1, rotationReason = 'manual', dryRun = false } = opts;
  const generatePassword = opts.generatePassword ?? generateCredentialPassword;
  const userName = documentdbUserName(tenantId);
  const namespace = documentdbNamespace(tenantId);
  const runCommand = resolveRunCommand(credentials);
  const credentialVersion = Number(currentVersion) + 1;

  if (dryRun) {
    return { rotated: false, userName, credentialVersion, secretRef: null, oneTimeCredential: null };
  }

  const password = generatePassword();
  try {
    await runCommand(namespace, { updateUser: userName, pwd: password });
  } catch (err) {
    const error = new Error(`${DOCUMENTDB_IDENTITY_PROVISION_FAILED}: updateUser for tenant '${tenantId}' failed: ${err.message}`);
    error.code = DOCUMENTDB_IDENTITY_PROVISION_FAILED;
    error.cause = err;
    throw error;
  }

  const secretRef = await persistCredential({ secretStore, tenantId, userName, password, credentialVersion });

  await safeEmitAudit(emitAudit, {
    eventCategory: 'credential_rotation',
    eventType: 'documentdb_identity_rotated',
    tenantId,
    subject: userName,
    namespace,
    credentialVersion,
    rotationReason,
  });

  return { rotated: true, userName, credentialVersion, secretRef, oneTimeCredential: { userName, password, namespace } };
}

/**
 * Revoke the per-tenant credential: issue `dropUser` over the wire protocol. Idempotent —
 * a missing user is a clean no-op (pre-migration tenants that never had a credential).
 *
 * @param {string} tenantId
 * @param {Object} [opts]
 * @returns {Promise<{ revoked: boolean, userName: string, alreadyAbsent: boolean }>}
 */
export async function revokeTenantIdentity(tenantId, opts = {}) {
  const { credentials = {}, emitAudit, dryRun = false, log = console } = opts;
  const userName = documentdbUserName(tenantId);
  const namespace = documentdbNamespace(tenantId);
  const runCommand = resolveRunCommand(credentials);

  if (!(await userExists(runCommand, namespace, userName))) {
    log?.info?.(`[documentdb-identity] no credential for ${userName}; offboarding no-op`);
    return { revoked: false, userName, alreadyAbsent: true };
  }

  if (dryRun) {
    return { revoked: false, userName, alreadyAbsent: false };
  }

  try {
    await runCommand(namespace, { dropUser: userName });
  } catch (err) {
    const error = new Error(`${DOCUMENTDB_IDENTITY_PROVISION_FAILED}: dropUser for tenant '${tenantId}' failed: ${err.message}`);
    error.code = DOCUMENTDB_IDENTITY_PROVISION_FAILED;
    error.cause = err;
    throw error;
  }

  await safeEmitAudit(emitAudit, {
    eventCategory: 'credential_rotation',
    eventType: 'documentdb_identity_revoked',
    tenantId,
    subject: userName,
    namespace,
    rotationReason: 'tenant_offboarding',
  });

  return { revoked: true, userName, alreadyAbsent: false };
}

/**
 * Applier `apply` adapter (parity with the other appliers' contract for the reprovision
 * registry). Provisions the per-tenant identity and returns a DomainResult.
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData = {}, options = {}) {
  const dryRun = options.dryRun ?? false;
  try {
    const result = await provisionTenantIdentity(tenantId, { ...options, dryRun });
    const action = result.provisioned ? (dryRun ? 'would_create' : 'created') : (dryRun ? 'would_skip' : 'skipped');
    return {
      domain_key: DOMAIN_KEY,
      status: result.provisioned ? (dryRun ? 'would_apply' : 'applied') : (dryRun ? 'would_skip' : 'skipped'),
      resource_results: [{ resource_type: 'documentdb_identity', resource_name: result.userName, resource_id: result.userName, action, message: null, warnings: [], diff: null }],
      counts: { created: result.provisioned ? 1 : 0, skipped: result.provisioned ? 0 : 1, conflicts: 0, errors: 0, warnings: 0 },
      message: null,
    };
  } catch (err) {
    return {
      domain_key: DOMAIN_KEY,
      status: 'error',
      resource_results: [{ resource_type: 'documentdb_identity', resource_name: documentdbUserName(tenantId), resource_id: null, action: 'error', message: err.message, warnings: [], diff: null }],
      counts: { created: 0, skipped: 0, conflicts: 0, errors: 1, warnings: 0 },
      message: err.message,
    };
  }
}

/**
 * Applier `teardown` adapter — symmetric reverse of {@link apply}. Revokes the identity.
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function teardown(tenantId, domainData = {}, options = {}) {
  const dryRun = options.dryRun ?? false;
  try {
    const result = await revokeTenantIdentity(tenantId, { ...options, dryRun });
    const action = result.revoked ? (dryRun ? 'would_remove' : 'removed') : 'skipped';
    return {
      domain_key: DOMAIN_KEY,
      status: result.revoked ? (dryRun ? 'would_apply' : 'applied') : 'skipped',
      resource_results: [{ resource_type: 'documentdb_identity', resource_name: result.userName, resource_id: result.userName, action, message: result.alreadyAbsent ? 'no credential present (no-op)' : null, warnings: [], diff: null }],
      counts: { created: 0, skipped: result.revoked ? 0 : 1, conflicts: 0, errors: 0, warnings: 0 },
      message: null,
    };
  } catch (err) {
    return {
      domain_key: DOMAIN_KEY,
      status: 'error',
      resource_results: [{ resource_type: 'documentdb_identity', resource_name: documentdbUserName(tenantId), resource_id: null, action: 'error', message: err.message, warnings: [], diff: null }],
      counts: { created: 0, skipped: 0, conflicts: 0, errors: 1, warnings: 0 },
      message: err.message,
    };
  }
}

/**
 * Write the plaintext password to the secret store (Vault/ESO, ADR-9) and return a
 * reference. No-op (returns null) if no secret store is injected — the one-time envelope
 * still carries the password to the caller. The plaintext is NEVER persisted relationally.
 */
async function persistCredential({ secretStore, tenantId, userName, password, credentialVersion }) {
  if (!secretStore || typeof secretStore.put !== 'function') return null;
  const path = `documentdb/tenants/${userName}/credential`;
  const ref = await secretStore.put({ tenantId, path, value: password, version: credentialVersion });
  return { name: ref?.name ?? userName, path: ref?.path ?? path };
}

async function safeEmitAudit(emitAudit, event) {
  if (typeof emitAudit !== 'function') return;
  try {
    await emitAudit(event);
  } catch {
    // Audit emission must never fail the provisioning path; the credential is the source
    // of truth and the audit pipeline reconciles asynchronously.
  }
}
