// OpenBao KV v2 secrets backend (add-vault-secret-consumption, #612; backend switched
// Vault -> OpenBao in replace-vault-with-openbao).
//
// A direct KV v2 client + a per-tenant/per-workspace workspace-secret store. The control-plane
// WRITES a secret to OpenBao when it is set via the API, and READS it back to inject it into a
// function's runtime env at deploy time. This is the "missing consumer": the chart can deploy
// OpenBao (values-kind-vault.yaml, self-signed TLS on kind), but until #612 no Falcone component
// read from or wrote to it.
//
// The KV v2 REST surface is byte-compatible between Vault and OpenBao (paths
// /v1/{mount}/data|metadata/..., ?list=true, and the X-Vault-Token request header — OpenBao honors
// the X-Vault-* headers), so this client is backend-neutral and unchanged behaviorally by the swap.
//
// Isolation is path-based and credential-derived: every secret lives at
//   {mount}/data/falcone/workspace-secrets/{tenantId}/{workspaceId}/{name}
// so no tenant or workspace can address another's path (the workspaceId segment is the per-env
// boundary). Values are write-only over the API — GET returns metadata only; only a server-side
// function deploy resolves the actual value to inject as env.
//
// TLS: on kind, OpenBao uses a self-signed CA (the openbao-tls-bootstrap Job). The client trusts it
// via NODE_EXTRA_CA_CERTS (mounted from the openbao-server-tls Secret) so the default global fetch
// works — no in-code certificate handling. fetchImpl is injectable for tests (a plain-HTTP fake).

const ENC = (s) => encodeURIComponent(String(s));
const SECRET_ROOT = 'falcone/workspace-secrets';

/** The Vault KV path for one workspace secret (raw; segments are encoded by the client). */
export function workspaceSecretPath(tenantId, workspaceId, name) {
  return `${SECRET_ROOT}/${tenantId}/${workspaceId}/${name}`;
}

/** The Vault KV prefix that lists one workspace's secrets. */
export function workspaceSecretPrefix(tenantId, workspaceId) {
  return `${SECRET_ROOT}/${tenantId}/${workspaceId}`;
}

function vaultError(op, path, status) {
  const e = new Error(`vault ${op} ${path} -> HTTP ${status}`);
  e.statusCode = 502;
  e.vaultStatus = status;
  return e;
}

/**
 * A minimal Vault KV v2 client. Methods map to the KV v2 REST surface:
 *   write    → POST   {mount}/data/{path}      body { data }
 *   read     → GET    {mount}/data/{path}
 *   readMeta → GET    {mount}/metadata/{path}   (KV v2 metadata: created_time/updated_time/versions)
 *   delete   → DELETE {mount}/metadata/{path}  (removes ALL versions)
 *   list     → GET    {mount}/metadata/{path}?list=true
 */
export function createVaultKvClient({ addr, token, mount = 'secret', namespace, fetchImpl = globalThis.fetch } = {}) {
  if (!addr) throw new TypeError('createVaultKvClient requires a Vault addr');
  if (!token) throw new TypeError('createVaultKvClient requires a Vault token');
  const base = String(addr).replace(/\/+$/, '');
  const seg = (p) => String(p).split('/').filter(Boolean).map(ENC).join('/');
  const dataUrl = (p) => `${base}/v1/${ENC(mount)}/data/${seg(p)}`;
  const metaUrl = (p) => `${base}/v1/${ENC(mount)}/metadata/${seg(p)}`;
  const headers = () => ({
    'x-vault-token': token,
    ...(namespace ? { 'x-vault-namespace': namespace } : {}),
    'content-type': 'application/json',
    accept: 'application/json',
  });
  const send = (method, u, body) => fetchImpl(u, {
    method, headers: headers(), body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  return {
    async writeSecret(path, data) {
      const res = await send('POST', dataUrl(path), { data });
      if (!res.ok) throw vaultError('write', path, res.status);
      const json = await res.json().catch(() => ({}));
      return { version: Number(json?.data?.version ?? 1) };
    },
    async readSecret(path) {
      const res = await send('GET', dataUrl(path));
      if (res.status === 404) return null;
      if (!res.ok) throw vaultError('read', path, res.status);
      const json = await res.json();
      return { data: json?.data?.data ?? {}, version: Number(json?.data?.metadata?.version ?? 0) };
    },
    // KV v2 metadata read: GET {mount}/metadata/{path} (no ?list). Returns the REAL OpenBao KV-v2
    // metadata fields created_time / updated_time (snake_case on the wire) mapped to createdTime /
    // updatedTime; null when the metadata path 404s (the secret does not exist). The createdTime is
    // the time of v1; updatedTime tracks the current version's create time.
    async readMeta(path) {
      const res = await send('GET', metaUrl(path));
      if (res.status === 404) return null;
      if (!res.ok) throw vaultError('read-meta', path, res.status);
      const json = await res.json();
      const d = json?.data ?? {};
      return {
        createdTime: d.created_time ?? null,
        updatedTime: d.updated_time ?? null,
        currentVersion: Number(d.current_version ?? 0),
      };
    },
    async deleteSecret(path) {
      const res = await send('DELETE', metaUrl(path));
      if (!res.ok && res.status !== 404) throw vaultError('delete', path, res.status);
      return { deleted: true };
    },
    async listSecrets(prefix) {
      const res = await send('GET', `${metaUrl(prefix)}?list=true`);
      if (res.status === 404) return [];
      if (!res.ok) throw vaultError('list', prefix, res.status);
      const json = await res.json();
      return Array.isArray(json?.data?.keys) ? json.data.keys : [];
    },
  };
}

// Function-secret names: lowercase, letter-first, <=63 (matches FUNCTION_SECRET_NAME_PATTERN).
const SECRET_NAME_RE = /^[a-z][a-z0-9_-]{0,62}$/;

/** Default env-var name for a secret (UPPER_SNAKE) when a ref does not specify one. */
export function secretEnvVarName(name) {
  return String(name).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

// Reserved (non-secret) key carried alongside the secret value in the KV data map. The store
// whitelists this on the read path so a description is surfaced as metadata, while the secret
// `value` is NEVER returned by any metadata method (only getValue/resolveEnv read `value`).
const DESC_KEY = '_desc';

// Shape one secret's non-secret metadata (the published FunctionWorkspaceSecret minus tenantId/
// workspaceId, which the handler stamps from the verified workspace). NEVER carries `value` and
// NEVER carries a KV `version` (KV-v2 versioning stays internal; the schema is additionalProperties:
// false). `name` is retained as a backward-compat alias of `secretName`.
function metaShape(name, { data, meta } = {}) {
  const description = data && typeof data[DESC_KEY] === 'string' ? data[DESC_KEY] : undefined;
  const createdAt = meta?.createdTime ?? null;
  const updatedAt = meta?.updatedTime ?? meta?.createdTime ?? null;
  return {
    secretName: name,
    name, // backward-compat alias (pre-convergence callers read { name })
    timestamps: { createdAt, updatedAt },
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * A per-tenant/per-workspace workspace-secret store over a KV v2 client. All paths are derived from
 * the (credential-verified) tenantId + workspaceId, never from the secret value or env name.
 *
 * Values are write-only: `getValue`/`resolveEnv` are the SOLE value-returning methods and are used
 * server-side only (function deploy). `getMeta`/`list` return non-secret metadata (timestamps,
 * optional description) and NEVER the value. A non-secret `description` rides in the KV data map under
 * the reserved `_desc` key; the read path whitelists it so it surfaces as metadata only.
 */
export function createWorkspaceSecretStore(client) {
  // Internal: write a secret value (+ optional description) at the workspace path. Shared by the
  // create (set) and replace paths — KV-v2 writes a new version either way; the create-vs-replace
  // distinction (conflict on an existing name) is enforced by the caller via exists().
  async function write(tenantId, workspaceId, name, value, description) {
    const data = { value: String(value) };
    if (typeof description === 'string' && description.length > 0) data[DESC_KEY] = description;
    await client.writeSecret(workspaceSecretPath(tenantId, workspaceId, name), data);
  }

  // Internal: read this secret's non-secret metadata (description + KV-v2 timestamps), or null when
  // the secret does not exist. Reads BOTH the data map (for the whitelisted description) and the
  // KV-v2 metadata (for created/updated times) — never exposing the value.
  async function readMetaShape(tenantId, workspaceId, name) {
    const path = workspaceSecretPath(tenantId, workspaceId, name);
    const r = await client.readSecret(path);
    if (!r) return null;
    let meta = null;
    if (typeof client.readMeta === 'function') {
      try { meta = await client.readMeta(path); } catch { meta = null; }
    }
    return metaShape(name, { data: r.data, meta });
  }

  return {
    validName: (n) => SECRET_NAME_RE.test(String(n ?? '')),

    // CREATE or REPLACE the value at the workspace path (KV-v2 new version). Returns metadata only
    // (no value, no version). The handler enforces POST=create-only via exists() before calling.
    async set(tenantId, workspaceId, name, value, description) {
      await write(tenantId, workspaceId, name, value, description);
      return (await readMetaShape(tenantId, workspaceId, name))
        ?? metaShape(name, { data: { ...(description ? { [DESC_KEY]: description } : {}) }, meta: null });
    },

    // Alias for the PUT replace path (same KV write; prior version superseded).
    async replace(tenantId, workspaceId, name, value, description) {
      return this.set(tenantId, workspaceId, name, value, description);
    },

    // Existence probe for the create-only POST conflict check (true when the secret already exists).
    async exists(tenantId, workspaceId, name) {
      const r = await client.readSecret(workspaceSecretPath(tenantId, workspaceId, name));
      return r != null;
    },

    async getMeta(tenantId, workspaceId, name) {
      return readMetaShape(tenantId, workspaceId, name);
    },

    // Resolve the raw value — server-side only (function deploy); never returned over the API.
    async getValue(tenantId, workspaceId, name) {
      const r = await client.readSecret(workspaceSecretPath(tenantId, workspaceId, name));
      return r ? r.data.value ?? null : null;
    },

    async list(tenantId, workspaceId) {
      const keys = await client.listSecrets(workspaceSecretPrefix(tenantId, workspaceId));
      const names = keys.filter((k) => !String(k).endsWith('/'));
      const out = [];
      for (const name of names) {
        out.push((await readMetaShape(tenantId, workspaceId, name)) ?? metaShape(name));
      }
      return out;
    },

    async delete(tenantId, workspaceId, name) {
      await client.deleteSecret(workspaceSecretPath(tenantId, workspaceId, name));
      return { name, deleted: true };
    },

    // Resolve declared secret references to function env entries [{ name, value }]. A ref is either
    // a secret name (string → UPPER_SNAKE env var) or { name|secretName, env }. Missing secrets are
    // skipped (the function deploy does not fail because a secret is absent).
    async resolveEnv(tenantId, workspaceId, refs = []) {
      const out = [];
      for (const ref of Array.isArray(refs) ? refs : []) {
        const secretName = typeof ref === 'string' ? ref : (ref?.name ?? ref?.secretName);
        if (!secretName) continue;
        const envName = (ref && typeof ref === 'object' && ref.env) ? ref.env : secretEnvVarName(secretName);
        const value = await this.getValue(tenantId, workspaceId, secretName);
        if (value != null) out.push({ name: envName, value: String(value) });
      }
      return out;
    },
  };
}

/**
 * Build the workspace-secret store from the environment, or return null when the backend is not
 * configured — keeping the secrets feature off by default with zero behaviour change. The chart
 * injects these into the control-plane Deployment only when openbao.enabled.
 *
 * Reads the canonical OpenBao env (BAO_ADDR/BAO_TOKEN/BAO_KV_MOUNT/BAO_NAMESPACE) first, falling back
 * to the legacy Vault env (VAULT_ADDR/VAULT_TOKEN/VAULT_KV_MOUNT/VAULT_NAMESPACE) so existing
 * configuration keeps working unchanged after the Vault -> OpenBao swap. The wire header stays
 * X-Vault-Token (OpenBao honors it).
 */
export function vaultStoreFromEnv(env = process.env, fetchImpl) {
  const addr = env.BAO_ADDR ?? env.VAULT_ADDR;
  const token = env.BAO_TOKEN ?? env.VAULT_TOKEN;
  if (!addr || !token) return null;
  const client = createVaultKvClient({
    addr,
    token,
    mount: env.BAO_KV_MOUNT ?? env.VAULT_KV_MOUNT ?? 'secret',
    namespace: env.BAO_NAMESPACE ?? env.VAULT_NAMESPACE ?? undefined,
    fetchImpl,
  });
  return createWorkspaceSecretStore(client);
}
