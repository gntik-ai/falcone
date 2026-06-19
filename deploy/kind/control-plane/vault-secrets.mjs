// Vault KV v2 secrets backend (add-vault-secret-consumption, #612).
//
// A direct HashiCorp Vault KV v2 client + a per-tenant/per-workspace workspace-secret store. The
// control-plane WRITES a secret to Vault when it is set via the API, and READS it back to inject it
// into a function's runtime env at deploy time. This is the "missing consumer": the chart can deploy
// Vault (values-kind-vault.yaml, self-signed TLS on kind), but until now no Falcone component read
// from or wrote to it.
//
// Isolation is path-based and credential-derived: every secret lives at
//   {mount}/data/falcone/workspace-secrets/{tenantId}/{workspaceId}/{name}
// so no tenant or workspace can address another's path (the workspaceId segment is the per-env
// boundary). Values are write-only over the API — GET returns metadata only; only a server-side
// function deploy resolves the actual value to inject as env.
//
// TLS: on kind, Vault uses a self-signed CA (the vault-tls-bootstrap Job). The client trusts it via
// NODE_EXTRA_CA_CERTS (mounted from the vault-server-tls Secret) so the default global fetch works —
// no in-code certificate handling. fetchImpl is injectable for tests (a plain-HTTP fake Vault).

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
 *   write  → POST   {mount}/data/{path}      body { data }
 *   read   → GET    {mount}/data/{path}
 *   delete → DELETE {mount}/metadata/{path}  (removes ALL versions)
 *   list   → GET    {mount}/metadata/{path}?list=true
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

/**
 * A per-tenant/per-workspace workspace-secret store over a KV v2 client. All paths are derived from
 * the (credential-verified) tenantId + workspaceId, never from the secret value or env name.
 */
export function createWorkspaceSecretStore(client) {
  return {
    validName: (n) => SECRET_NAME_RE.test(String(n ?? '')),

    async set(tenantId, workspaceId, name, value) {
      const { version } = await client.writeSecret(workspaceSecretPath(tenantId, workspaceId, name), { value: String(value) });
      return { name, version, updatedAt: new Date().toISOString() };
    },

    async getMeta(tenantId, workspaceId, name) {
      const r = await client.readSecret(workspaceSecretPath(tenantId, workspaceId, name));
      return r ? { name, version: r.version } : null;
    },

    // Resolve the raw value — server-side only (function deploy); never returned over the API.
    async getValue(tenantId, workspaceId, name) {
      const r = await client.readSecret(workspaceSecretPath(tenantId, workspaceId, name));
      return r ? r.data.value ?? null : null;
    },

    async list(tenantId, workspaceId) {
      const keys = await client.listSecrets(workspaceSecretPrefix(tenantId, workspaceId));
      return keys.filter((k) => !String(k).endsWith('/')).map((name) => ({ name }));
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
 * Build the workspace-secret store from the environment, or return null when Vault is not configured
 * (VAULT_ADDR/VAULT_TOKEN unset) — keeping the secrets feature off by default with zero behaviour
 * change. The chart injects these into the control-plane Deployment only when vault.enabled.
 */
export function vaultStoreFromEnv(env = process.env, fetchImpl) {
  if (!env.VAULT_ADDR || !env.VAULT_TOKEN) return null;
  const client = createVaultKvClient({
    addr: env.VAULT_ADDR,
    token: env.VAULT_TOKEN,
    mount: env.VAULT_KV_MOUNT || 'secret',
    namespace: env.VAULT_NAMESPACE || undefined,
    fetchImpl,
  });
  return createWorkspaceSecretStore(client);
}
