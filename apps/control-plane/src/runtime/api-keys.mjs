// Workspace API keys (change: add-app-api-keys).
//
// Supabase-style credentials a frontend/app uses to call the data API:
//   - ANON  key: publishable (browser-safe); resolves to a restricted, RLS-governed DB role.
//   - SERVICE key: secret; resolves to an elevated DB role.
// Keys are stored HASHED (SHA-256); the plaintext is shown once at issuance and never again.
// Verification resolves a presented key to {tenantId, workspaceId, keyType, scopes, dbRole}.
//
// The control-plane trusts gateway-injected identity headers for the JWT path; for the
// API-key path the control-plane verifies the key itself and derives the same identity.
// (On the gateway, the APISIX key-auth plugin can front this store — deploy config.)
import { createHash, randomBytes } from 'node:crypto';

const KEY_TYPES = Object.freeze(['anon', 'service']);
const ROLE_BY_TYPE = Object.freeze({ anon: 'falcone_anon', service: 'falcone_service' });
const SCOPES_BY_TYPE = Object.freeze({
  anon: ['data:read'],
  service: ['data:read', 'data:write', 'ddl:write'],
});

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function generateKey(keyType) {
  // flc_<type>_<32 url-safe bytes>. The prefix (through the type) is safe to display.
  const secret = randomBytes(24).toString('base64url');
  const key = `flc_${keyType}_${secret}`;
  return { key, prefix: key.slice(0, 16) };
}

export function createApiKeyStore({ pool }) {
  if (!pool) throw new TypeError('createApiKeyStore requires a pg pool');

  async function ensureSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS workspace_api_keys (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL,
      workspace_id text NOT NULL,
      key_type text NOT NULL CHECK (key_type IN ('anon','service')),
      key_prefix text NOT NULL,
      key_hash text NOT NULL UNIQUE,
      scopes text[] NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      revoked_at timestamptz
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_wak_workspace ON workspace_api_keys (workspace_id) WHERE status = \'active\'');
  }

  function clientError(message, statusCode, code) {
    return Object.assign(new Error(message), { statusCode, code });
  }

  async function issueKey({ tenantId, workspaceId, keyType = 'anon', scopes } = {}) {
    if (!tenantId || !workspaceId) throw clientError('tenantId and workspaceId are required', 400, 'IDENTITY_MISSING');
    if (!KEY_TYPES.includes(keyType)) throw clientError(`Invalid key type ${keyType}`, 400, 'INVALID_KEY_TYPE');
    const { key, prefix } = generateKey(keyType);
    const effectiveScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : SCOPES_BY_TYPE[keyType];
    const res = await pool.query(
      `INSERT INTO workspace_api_keys (tenant_id, workspace_id, key_type, key_prefix, key_hash, scopes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, key_prefix, key_type, scopes, created_at`,
      [tenantId, workspaceId, keyType, prefix, sha256(key), effectiveScopes],
    );
    const row = res.rows[0];
    // `key` (plaintext) is returned ONCE here and never stored.
    return { id: row.id, key, prefix: row.key_prefix, keyType: row.key_type, scopes: row.scopes, createdAt: row.created_at };
  }

  // Resolve a presented key to an identity, or null if unknown/revoked.
  async function verifyKey(presentedKey) {
    if (typeof presentedKey !== 'string' || !presentedKey.startsWith('flc_')) return null;
    const res = await pool.query(
      `UPDATE workspace_api_keys SET last_used_at = now()
        WHERE key_hash = $1 AND status = 'active'
        RETURNING tenant_id, workspace_id, key_type, scopes`,
      [sha256(presentedKey)],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      keyType: row.key_type,
      scopes: row.scopes,
      dbRole: ROLE_BY_TYPE[row.key_type],
      roleName: ROLE_BY_TYPE[row.key_type],
    };
  }

  async function listKeys(workspaceId) {
    const res = await pool.query(
      `SELECT id, key_type, key_prefix, scopes, status, created_at, last_used_at
         FROM workspace_api_keys WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspaceId],
    );
    return res.rows; // never includes the hash or the plaintext
  }

  async function revokeKey({ id, workspaceId }) {
    const res = await pool.query(
      `UPDATE workspace_api_keys SET status = 'revoked', revoked_at = now()
        WHERE id = $1 AND workspace_id = $2 AND status = 'active' RETURNING id`,
      [id, workspaceId],
    );
    if (res.rowCount === 0) throw clientError('Key not found', 404, 'KEY_NOT_FOUND');
    return { id, revoked: true };
  }

  // Rotate = revoke the old key and issue a fresh one of the same type.
  async function rotateKey({ id, workspaceId }) {
    const cur = await pool.query('SELECT tenant_id, workspace_id, key_type, scopes FROM workspace_api_keys WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
    if (cur.rowCount === 0) throw clientError('Key not found', 404, 'KEY_NOT_FOUND');
    await revokeKey({ id, workspaceId }).catch(() => {});
    const row = cur.rows[0];
    return issueKey({ tenantId: row.tenant_id, workspaceId: row.workspace_id, keyType: row.key_type, scopes: row.scopes });
  }

  return { ensureSchema, issueKey, verifyKey, listKeys, revokeKey, rotateKey };
}

export { ROLE_BY_TYPE, SCOPES_BY_TYPE, KEY_TYPES };
