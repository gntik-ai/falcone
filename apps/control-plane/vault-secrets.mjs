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
// via NODE_EXTRA_CA_CERTS (mounted from the chart-synced client CA Secret) so the default global
// fetch works — no in-code certificate handling. fetchImpl is injectable for tests (a plain-HTTP fake).

import { readFileSync } from 'node:fs';

const ENC = (s) => encodeURIComponent(String(s));
const SECRET_ROOT = 'falcone/workspace-secrets';
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

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
export function createKubernetesAuthTokenProvider({
  addr,
  role,
  authMount = 'kubernetes',
  namespace,
  serviceAccountJwtPath = '/var/run/secrets/kubernetes.io/serviceaccount/token',
  fetchImpl = globalThis.fetch,
  now = Date.now,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  random = Math.random,
  log = console.error,
} = {}) {
  if (!addr) throw new TypeError('createKubernetesAuthTokenProvider requires a Vault addr');
  if (!role) throw new TypeError('createKubernetesAuthTokenProvider requires a Kubernetes auth role');
  const base = String(addr).replace(/\/+$/, '');
  const mount = encodeURIComponent(String(authMount).replace(/^\/+|\/+$/g, '') || 'kubernetes');
  let cachedToken = null;
  let expiresAt = 0;
  let nextRetryAt = 0;
  let timer = null;
  let inFlight = null;
  const health = { state: 'starting', lastSuccessAt: null, lastFailureAt: null,
    lastFailureStatus: null, consecutiveFailures: 0, tokenExpiresAt: null };
  const headers = { 'content-type': 'application/json', accept: 'application/json',
    ...(namespace ? { 'x-vault-namespace': namespace } : {}) };

  function clearTimer() {
    if (timer) clearTimeoutImpl(timer);
    timer = null;
  }
  function schedule(delay, action) {
    clearTimer();
    const deadline = now() + Math.max(0, delay);
    const arm = () => {
      timer = setTimeoutImpl(() => {
        timer = null;
        if (now() < deadline) arm();
        else void action().catch(() => {});
      }, Math.min(MAX_TIMER_DELAY_MS, Math.max(0, deadline - now())));
      timer?.unref?.();
    };
    arm();
  }
  async function authJson(url, options, op, path) {
    const controller = new AbortController();
    let timeout;
    try {
      return await Promise.race([
        (async () => {
          const res = await fetchImpl(url, { ...options, signal: controller.signal });
          if (!res.ok) throw vaultError(op, path, res.status);
          return res.json();
        })(),
        new Promise((_, reject) => {
          timeout = setTimeoutImpl(() => {
            controller.abort();
            reject(vaultError('auth', 'request', 502));
          }, AUTH_REQUEST_TIMEOUT_MS);
          timeout?.unref?.();
        }),
      ]);
    } finally {
      if (timeout) clearTimeoutImpl(timeout);
    }
  }
  function failure(status) {
    const transition = health.state !== 'degraded';
    health.state = 'degraded';
    health.lastFailureAt = new Date(now()).toISOString();
    health.lastFailureStatus = status;
    health.consecutiveFailures++;
    // Log only fixed fields. Neither upstream response bodies nor thrown errors are safe to log.
    if (transition) log(JSON.stringify({ event: 'secret_backend_auth_failure', role, authMount,
      status, consecutiveFailures: health.consecutiveFailures }));
  }
  function success(token, leaseSeconds, renewable) {
    cachedToken = token;
    const parsedLease = Number(leaseSeconds);
    const leaseMs = Math.max(1000, (Number.isFinite(parsedLease) && parsedLease > 0 ? parsedLease : 3600) * 1000);
    expiresAt = now() + leaseMs;
    nextRetryAt = 0;
    health.state = 'ok';
    health.lastSuccessAt = new Date(now()).toISOString();
    health.consecutiveFailures = 0;
    health.tokenExpiresAt = new Date(expiresAt).toISOString();
    // Renew after half the lease, leaving time for a bounded re-login before expiry.
    schedule(leaseMs * 0.55, () => renewable ? renew() : login());
  }
  function singleFlight(action) {
    if (inFlight) return inFlight;
    const pending = Promise.resolve().then(action);
    inFlight = pending;
    void pending.finally(() => { if (inFlight === pending) inFlight = null; }).catch(() => {});
    return pending;
  }
  function retry() {
    const cap = Math.min(60_000, 1000 * 2 ** Math.min(health.consecutiveFailures - 1, 6));
    const delay = cap * (0.5 + random() * 0.5);
    nextRetryAt = now() + delay;
    schedule(delay, () => login());
  }
  async function performLogin() {
    try {
      const jwt = readFileSync(serviceAccountJwtPath, 'utf8').trim();
      const auth = (await authJson(`${base}/v1/auth/${mount}/login`, {
        method: 'POST', headers, body: JSON.stringify({ role, jwt }),
      }, 'kubernetes-login', `auth/${authMount}/login`))?.auth;
      if (!auth?.client_token) throw vaultError('kubernetes-login', `auth/${authMount}/login`, 502);
      success(auth.client_token, auth.lease_duration, auth.renewable === true);
      return cachedToken;
    } catch (error) {
      failure(Number(error?.vaultStatus) || 0);
      retry();
      throw vaultError('kubernetes-login', `auth/${authMount}/login`, Number(error?.vaultStatus) || 502);
    }
  }
  function login() {
    return singleFlight(performLogin);
  }
  function renew() {
    return singleFlight(async () => {
      if (!cachedToken || now() >= expiresAt) return performLogin();
      try {
        const previousExpiry = expiresAt;
        const auth = (await authJson(`${base}/v1/auth/token/renew-self`, {
          method: 'POST', headers: { ...headers, 'x-vault-token': cachedToken }, body: '{}',
        }, 'renew-self', 'auth/token/renew-self'))?.auth;
        const leaseMs = Number(auth?.lease_duration) * 1000;
        if (!Number.isFinite(leaseMs) || leaseMs <= 0 || now() + leaseMs <= previousExpiry)
          throw vaultError('renew-self', 'auth/token/renew-self', 502);
        success(auth?.client_token || cachedToken, auth.lease_duration, auth.renewable === true);
        return cachedToken;
      } catch {
        // A failed renewal is recovered by re-login; report degradation only if that fails too.
        return performLogin();
      }
    });
  }
  const provider = async () => {
    if (cachedToken && now() < expiresAt) return cachedToken;
    if (inFlight) return inFlight;
    if (now() < nextRetryAt) throw vaultError('kubernetes-login', `auth/${authMount}/login`, health.lastFailureStatus || 502);
    return login();
  };
  provider.invalidate = async (rejectedToken) => {
    if (inFlight) await inFlight.catch(() => {});
    if (cachedToken === rejectedToken) {
      cachedToken = null;
      expiresAt = 0;
      health.tokenExpiresAt = null;
      // A failed login has already armed a backoff retry. Keep it alive after a KV 403.
      if (now() >= nextRetryAt) clearTimer();
    }
    return provider();
  };
  provider.getHealthSnapshot = () => ({ ...health });
  // Start auth without blocking module import, and consume the rejection until a caller arrives.
  void login().catch(() => {});
  return provider;
}

export function createVaultKvClient({ addr, token, tokenProvider, mount = 'secret', namespace, fetchImpl = globalThis.fetch } = {}) {
  if (!addr) throw new TypeError('createVaultKvClient requires a Vault addr');
  if (!token && typeof tokenProvider !== 'function') throw new TypeError('createVaultKvClient requires a Vault token or tokenProvider');
  const base = String(addr).replace(/\/+$/, '');
  const seg = (p) => String(p).split('/').filter(Boolean).map(ENC).join('/');
  const dataUrl = (p) => `${base}/v1/${ENC(mount)}/data/${seg(p)}`;
  const metaUrl = (p) => `${base}/v1/${ENC(mount)}/metadata/${seg(p)}`;
  const headers = (activeToken) => ({
    'x-vault-token': activeToken,
    ...(namespace ? { 'x-vault-namespace': namespace } : {}),
    'content-type': 'application/json',
    accept: 'application/json',
  });
  const send = async (method, u, body) => {
    let activeToken = token || await tokenProvider();
    const request = () => fetchImpl(u, {
      method, headers: headers(activeToken), body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let res = await request();
    if (res.status === 403 && !token && typeof tokenProvider.invalidate === 'function') {
      activeToken = await tokenProvider.invalidate(activeToken);
      res = await request();
    }
    return res;
  };

  return {
    getHealthSnapshot: () => tokenProvider?.getHealthSnapshot?.() ?? {
      state: 'ok', lastSuccessAt: null, lastFailureAt: null, lastFailureStatus: null,
      consecutiveFailures: 0, tokenExpiresAt: null,
    },
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
    getHealthSnapshot: () => client.getHealthSnapshot?.() ?? {
      state: 'ok', lastSuccessAt: null, lastFailureAt: null, lastFailureStatus: null,
      consecutiveFailures: 0, tokenExpiresAt: null,
    },
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
 * configured. The default chart configures BAO_ADDR plus BAO_KUBERNETES_AUTH_ROLE, so pods obtain
 * scoped OpenBao tokens through Kubernetes auth. BAO_TOKEN remains a break-glass/test path.
 *
 * Reads the canonical OpenBao env (BAO_ADDR/BAO_TOKEN/BAO_KV_MOUNT/BAO_NAMESPACE) first, falling back
 * to the legacy Vault env (VAULT_ADDR/VAULT_TOKEN/VAULT_KV_MOUNT/VAULT_NAMESPACE) so existing
 * configuration keeps working unchanged after the Vault -> OpenBao swap. The wire header stays
 * X-Vault-Token (OpenBao honors it).
 */
export function vaultStoreFromEnv(env = process.env, fetchImpl) {
  const addr = env.BAO_ADDR ?? env.VAULT_ADDR;
  const token = env.BAO_TOKEN ?? env.VAULT_TOKEN;
  const kubernetesRole = env.BAO_KUBERNETES_AUTH_ROLE ?? env.VAULT_KUBERNETES_AUTH_ROLE;
  if (!addr || (!token && !kubernetesRole)) return null;
  const namespace = env.BAO_NAMESPACE ?? env.VAULT_NAMESPACE ?? undefined;
  const client = createVaultKvClient({
    addr,
    token,
    tokenProvider: token ? undefined : createKubernetesAuthTokenProvider({
      addr,
      role: kubernetesRole,
      authMount: env.BAO_KUBERNETES_AUTH_MOUNT ?? env.VAULT_KUBERNETES_AUTH_MOUNT ?? 'kubernetes',
      namespace,
      serviceAccountJwtPath: env.BAO_SERVICEACCOUNT_JWT_PATH ?? env.VAULT_SERVICEACCOUNT_JWT_PATH,
      fetchImpl,
    }),
    mount: env.BAO_KV_MOUNT ?? env.VAULT_KV_MOUNT ?? 'secret',
    namespace,
    fetchImpl,
  });
  return createWorkspaceSecretStore(client);
}

/** Read-only process health for an optional workspace-secret store. */
export function vaultStoreHealthSnapshot(store) {
  return store?.getHealthSnapshot() ?? {
    state: 'disabled', lastSuccessAt: null, lastFailureAt: null,
    lastFailureStatus: null, consecutiveFailures: 0, tokenExpiresAt: null,
  };
}
