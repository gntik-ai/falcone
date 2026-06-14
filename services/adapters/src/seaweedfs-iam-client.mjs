// SeaweedFS IAM client (change add-seaweedfs-tenant-identities, Design D2).
//
// Thin, SDK-free wrapper around the SeaweedFS S3 `identities` model. Falcone
// onboards one identity per workspace (Design D1: `falcone-ws-{workspaceId}`),
// scoped to that workspace's bucket(s). The spike proved per-tenant identities
// can be added/removed live with no gateway restart and that per-bucket-scoped
// action strings (`"Read:bucket"`, `"Write:bucket"`, …) enforce cross-tenant
// denial at the S3 layer (spikes/add-seaweedfs-storage-adr-spike, evidence 10 +
// conf/s3-identities.json).
//
// Transport
// ---------
// The exact SeaweedFS admin wire protocol is resolved at deployment time
// (tasks.md 1.4 / Design OQ2). This client talks to a small admin transport with
// three operations — read the identities document, write it back, and trigger a
// reload — so the I/O surface is isolated and mockable. The default HTTP
// transport signs requests with AWS SigV4 (pure node:crypto, mirroring
// deploy/kind/control-plane/storage-handlers.mjs) against the admin endpoint:
//
//   GET  {SEAWEEDFS_S3_ADMIN_ENDPOINT}/s3/identities        -> { identities: [...] }
//   POST {SEAWEEDFS_S3_ADMIN_ENDPOINT}/s3/configure          (body { identities })
//   POST {SEAWEEDFS_S3_ADMIN_ENDPOINT}/s3/configure/reload   (reload trigger)
//
// Tests inject a `transport` (or point the env endpoint at a local mock server),
// so no live SeaweedFS is required for unit coverage.
//
// Env-var contract (documented here per tasks.md 1.4):
//   SEAWEEDFS_S3_ADMIN_ENDPOINT  admin endpoint base URL (S3 gateway / admin proxy)
//   SEAWEEDFS_ADMIN_ACCESS_KEY   admin access key used to sign IAM writes
//   SEAWEEDFS_ADMIN_SECRET_KEY   admin secret key used to sign IAM writes
//   SEAWEEDFS_S3_REGION          optional SigV4 region (default us-east-1)

import { createHash, createHmac } from 'node:crypto';

export const SEAWEEDFS_IAM_ENV = Object.freeze({
  endpoint: 'SEAWEEDFS_S3_ADMIN_ENDPOINT',
  accessKey: 'SEAWEEDFS_ADMIN_ACCESS_KEY',
  secretKey: 'SEAWEEDFS_ADMIN_SECRET_KEY',
  region: 'SEAWEEDFS_S3_REGION'
});

export const SEAWEEDFS_IAM_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY_SCOPE: 'INVALID_IDENTITY_SCOPE',
  IDENTITY_NOT_FOUND: 'IDENTITY_NOT_FOUND',
  IAM_CONFIG_MISSING: 'IAM_CONFIG_MISSING',
  IAM_WRITE_FAILED: 'IAM_WRITE_FAILED',
  IAM_DELETE_FAILED: 'IAM_DELETE_FAILED',
  IAM_RELOAD_FAILED: 'IAM_RELOAD_FAILED'
});

// Deterministic failures that must never be retried.
const NON_RETRYABLE_CODES = new Set([
  SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE,
  SEAWEEDFS_IAM_ERROR_CODES.IDENTITY_NOT_FOUND,
  SEAWEEDFS_IAM_ERROR_CODES.IAM_CONFIG_MISSING
]);

// SeaweedFS S3 action vocabulary (4.33). `Tagging` is accepted so callers may
// pass it through; the policy engine only emits Read/Write/List/Admin.
export const SEAWEEDFS_VALID_ACTIONS = Object.freeze(['Read', 'Write', 'List', 'Admin', 'Tagging']);

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 50;
const DEFAULT_REGION = 'us-east-1';

function iamError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw iamError(SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE, `${field} is required.`);
  }
  return value.trim();
}

// Fail-closed scope guard (tasks.md 2.3 + tenant-isolation spec "Absent or empty
// bucket scoping is rejected at identity write time"). An identity with no
// bucket, a wildcard bucket, or no actions would grant unscoped/ambiguous access
// and is rejected BEFORE any backend call.
function assertScopedIdentity({ buckets, actions }) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    throw iamError(
      SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE,
      'SeaweedFS identity must be scoped to at least one bucket.'
    );
  }
  for (const bucket of buckets) {
    const name = typeof bucket === 'string' ? bucket.trim() : '';
    if (!name) {
      throw iamError(
        SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE,
        'SeaweedFS identity bucket name must be a non-empty string.'
      );
    }
    if (name === '*' || name.includes('*')) {
      throw iamError(
        SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE,
        `SeaweedFS identity bucket scope must not contain a wildcard (got '${name}').`
      );
    }
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    throw iamError(
      SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE,
      'SeaweedFS identity must grant at least one action.'
    );
  }
  for (const action of actions) {
    if (!SEAWEEDFS_VALID_ACTIONS.includes(action)) {
      throw iamError(
        SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE,
        `Unsupported SeaweedFS action '${action}'.`
      );
    }
  }
}

function normalizeCredentials({ credentials, accessKey, secretKey }) {
  const list = Array.isArray(credentials) && credentials.length > 0
    ? credentials
    : [{ accessKey, secretKey }];
  return list.map((entry, index) => ({
    accessKey: assertNonEmptyString(entry?.accessKey, `credentials[${index}].accessKey`),
    secretKey: assertNonEmptyString(entry?.secretKey, `credentials[${index}].secretKey`)
  }));
}

/**
 * Build the canonical SeaweedFS identity document from Falcone's logical inputs.
 * Actions are expanded into per-bucket-scoped strings (`Action:bucket`) so the
 * grant can never leak to another bucket — matching the spike's proven isolation
 * shape (no global/wildcard grants are ever written).
 *
 * @param {{name:string, credentials?:Array<{accessKey:string,secretKey:string}>,
 *          accessKey?:string, secretKey?:string, actions:string[], buckets:string[]}} input
 * @returns {{name:string, credentials:Array<{accessKey:string,secretKey:string}>, actions:string[]}}
 */
export function buildSeaweedFSIdentity(input = {}) {
  const name = assertNonEmptyString(input.name, 'identity.name');
  const buckets = Array.isArray(input.buckets) ? input.buckets.map((b) => (typeof b === 'string' ? b.trim() : b)) : input.buckets;
  const actions = Array.isArray(input.actions) ? input.actions : input.actions;
  assertScopedIdentity({ buckets, actions });

  const credentials = normalizeCredentials(input);
  const scopedActions = [];
  for (const action of actions) {
    for (const bucket of buckets) {
      scopedActions.push(`${action}:${bucket}`);
    }
  }

  return { name, credentials, actions: scopedActions };
}

// ── SigV4 helpers (S3 service) — mirror storage-handlers.mjs ──────────────────
const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function amzDates(date) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signedHeaders({ method, endpoint, path, body, accessKey, secretKey, region, date }) {
  const url = new URL(endpoint);
  const host = url.host;
  const payload = body ?? '';
  const payloadHash = sha256hex(payload);
  const { amzDate, dateStamp } = amzDates(date);

  const canonicalUri = path.split('/').map((seg, i) => (i === 0 ? seg : enc(seg))).join('/') || '/';
  const hdrs = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signed = Object.keys(hdrs).sort().join(';');
  const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join('');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signed, payloadHash].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStamp), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;

  return {
    authorization,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'content-type': 'application/json'
  };
}

function resolveConfig(env = process.env) {
  const endpoint = env[SEAWEEDFS_IAM_ENV.endpoint];
  const accessKey = env[SEAWEEDFS_IAM_ENV.accessKey];
  const secretKey = env[SEAWEEDFS_IAM_ENV.secretKey];
  const region = env[SEAWEEDFS_IAM_ENV.region] || DEFAULT_REGION;
  if (!endpoint || !accessKey || !secretKey) {
    throw iamError(
      SEAWEEDFS_IAM_ERROR_CODES.IAM_CONFIG_MISSING,
      `SeaweedFS IAM config missing; set ${SEAWEEDFS_IAM_ENV.endpoint}, ${SEAWEEDFS_IAM_ENV.accessKey}, ${SEAWEEDFS_IAM_ENV.secretKey}.`
    );
  }
  return { endpoint: endpoint.replace(/\/+$/, ''), accessKey, secretKey, region };
}

/**
 * Default HTTP transport: SigV4-signed GET/POST against the admin endpoint.
 * `fetchImpl` and `now` are injectable for testing.
 */
export function createHttpTransport({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const { endpoint, accessKey, secretKey, region } = resolveConfig(env);

  async function request(method, path, bodyObj) {
    const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
    const headers = signedHeaders({ method, endpoint, path, body, accessKey, secretKey, region, date: now() });
    const res = await fetchImpl(`${endpoint}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : body
    });
    const text = await res.text();
    if (!res.ok) {
      const error = new Error(`SeaweedFS IAM ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
      error.statusCode = res.status;
      throw error;
    }
    return text ? JSON.parse(text) : {};
  }

  return {
    async readIdentities() {
      try {
        const doc = await request('GET', '/s3/identities');
        return Array.isArray(doc?.identities) ? doc.identities : [];
      } catch (error) {
        if (error.statusCode === 404) return [];
        throw error;
      }
    },
    async writeIdentities(identities) {
      await request('POST', '/s3/configure', { identities });
    },
    async reload() {
      await request('POST', '/s3/configure/reload');
    }
  };
}

// ── weed-shell transport (real SeaweedFS admin path — resolves Design OQ2) ────
// SeaweedFS 4.33 has no signed HTTP identity API; live per-tenant onboarding is
// `weed shell s3.configure -apply` (spike evidence 10, verified against the
// pinned image). This transport drives that real mechanism through an injected
// `exec(weedShellCommand) -> Promise<stdout>` (the caller wires `echo '<cmd>' |
// weed shell` over `docker exec` or `kubectl exec`). Static (bootstrap) identities
// are never rewritten/deleted.

function parseWeedShellConfig(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return { identities: [] };
  return JSON.parse(stdout.slice(start, end + 1));
}

// Reverse buildSeaweedFSIdentity's expansion: ["Read:b","Write:b"] -> {actions:[Read,Write], buckets:[b]}.
function unscopeActions(scopedActions = []) {
  const actions = [];
  const buckets = [];
  for (const entry of scopedActions) {
    const idx = entry.indexOf(':');
    const action = idx === -1 ? entry : entry.slice(0, idx);
    const bucket = idx === -1 ? null : entry.slice(idx + 1);
    if (!actions.includes(action)) actions.push(action);
    if (bucket && !buckets.includes(bucket)) buckets.push(bucket);
  }
  return { actions, buckets };
}

function sameIdentity(a, b) {
  const keys = (id) => (id.credentials ?? []).map((c) => c.accessKey).sort().join(',');
  const acts = (id) => [...(id.actions ?? [])].sort().join(',');
  return keys(a) === keys(b) && acts(a) === acts(b);
}

export function createWeedShellTransport({ exec } = {}) {
  if (typeof exec !== 'function') {
    throw iamError(SEAWEEDFS_IAM_ERROR_CODES.IAM_CONFIG_MISSING, 'createWeedShellTransport requires an exec(command) function.');
  }

  async function readRaw() {
    const out = await exec('s3.configure');
    return parseWeedShellConfig(out).identities ?? [];
  }

  return {
    async readIdentities() {
      return (await readRaw()).map((id) => ({
        name: id.name,
        credentials: (id.credentials ?? []).map((c) => ({ accessKey: c.accessKey, secretKey: c.secretKey })),
        actions: [...(id.actions ?? [])]
      }));
    },
    async writeIdentities(desired) {
      const raw = await readRaw();
      const staticNames = new Set(raw.filter((id) => id.isStatic).map((id) => id.name));
      const currentByName = new Map(raw.map((id) => [id.name, { credentials: (id.credentials ?? []).map((c) => ({ accessKey: c.accessKey })), actions: id.actions ?? [] }]));
      const desiredNames = new Set(desired.map((id) => id.name));

      // Delete identities no longer desired (never a static/bootstrap identity).
      for (const id of raw) {
        if (!desiredNames.has(id.name) && !staticNames.has(id.name)) {
          await exec(`s3.configure -user ${id.name} -delete -apply`);
        }
      }

      // Upsert each desired identity (skip static admin; skip unchanged).
      for (const id of desired) {
        if (staticNames.has(id.name)) continue;
        const current = currentByName.get(id.name);
        if (current && sameIdentity(current, id)) continue;
        if (current) await exec(`s3.configure -user ${id.name} -delete -apply`);
        const { actions, buckets } = unscopeActions(id.actions);
        for (const cred of id.credentials) {
          await exec(`s3.configure -user ${id.name} -access_key ${cred.accessKey} -secret_key ${cred.secretKey} -buckets ${buckets.join(',')} -actions ${actions.join(',')} -apply`);
        }
      }
    }
    // No reload(): `s3.configure -apply` reloads the running gateway live.
  };
}

function resolveTransport(opts = {}) {
  return opts.transport ?? createHttpTransport({ env: opts.env, fetchImpl: opts.fetchImpl, now: opts.now });
}

async function withRetry(fn, { maxAttempts = DEFAULT_MAX_ATTEMPTS, backoffMs = DEFAULT_BACKOFF_MS, sleep = defaultSleep } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      // A deterministic failure (fail-closed scope, missing identity/config) is
      // never retried.
      if (NON_RETRYABLE_CODES.has(error?.code)) throw error;
      if (attempt < maxAttempts) {
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

function upsertIdentity(identities, identity) {
  const next = identities.filter((entry) => entry?.name !== identity.name);
  next.push(identity);
  return next;
}

/**
 * Write (create or replace) a per-workspace SeaweedFS identity and reload the
 * gateway. Fail-closed on an unscoped/wildcard/actionless identity (before any
 * backend call). Retries transient transport failures with exponential back-off
 * so a reload timeout surfaces as a provisioning failure rather than a silent
 * success (Design risk: reload latency).
 *
 * @param {object} identity   logical identity ({name, credentials|accessKey/secretKey, actions, buckets})
 * @param {object} [opts]      { transport?, env?, fetchImpl?, now?, maxAttempts?, backoffMs?, sleep? }
 * @returns {Promise<{name:string, credentials:Array, actions:string[]}>} the canonical identity written
 */
export async function writeIdentity(identity, opts = {}) {
  const canonical = buildSeaweedFSIdentity(identity); // throws INVALID_IDENTITY_SCOPE before any I/O
  const transport = resolveTransport(opts);

  await withRetry(async () => {
    const current = await transport.readIdentities();
    await transport.writeIdentities(upsertIdentity(current, canonical));
    if (typeof transport.reload === 'function') await transport.reload();
  }, opts).catch((error) => {
    throw iamError(SEAWEEDFS_IAM_ERROR_CODES.IAM_WRITE_FAILED, `Failed to write SeaweedFS identity '${canonical.name}': ${error.message}`, error);
  });

  return canonical;
}

/**
 * Delete a SeaweedFS identity by name and reload so the key is immediately
 * rejected by the backend. Idempotent: deleting a missing identity is a success.
 *
 * @param {string} name
 * @param {object} [opts]
 * @returns {Promise<{name:string, deleted:boolean}>}
 */
export async function deleteIdentity(name, opts = {}) {
  const identityName = assertNonEmptyString(name, 'identity name');
  const transport = resolveTransport(opts);

  const deleted = await withRetry(async () => {
    const current = await transport.readIdentities();
    const existed = current.some((entry) => entry?.name === identityName);
    const next = current.filter((entry) => entry?.name !== identityName);
    await transport.writeIdentities(next);
    if (typeof transport.reload === 'function') await transport.reload();
    return existed;
  }, opts).catch((error) => {
    throw iamError(SEAWEEDFS_IAM_ERROR_CODES.IAM_DELETE_FAILED, `Failed to delete SeaweedFS identity '${identityName}': ${error.message}`, error);
  });

  return { name: identityName, deleted };
}

/**
 * Trigger an explicit identity reload on the gateway.
 * @param {object} [opts]
 * @returns {Promise<{reloaded:boolean}>}
 */
export async function reloadIdentities(opts = {}) {
  const transport = resolveTransport(opts);
  if (typeof transport.reload !== 'function') return { reloaded: false };
  await withRetry(() => transport.reload(), opts).catch((error) => {
    throw iamError(SEAWEEDFS_IAM_ERROR_CODES.IAM_RELOAD_FAILED, `Failed to reload SeaweedFS identities: ${error.message}`, error);
  });
  return { reloaded: true };
}

/**
 * Re-scope an existing identity's `actions` (e.g. a policy downgrade that removes
 * `Write`) while preserving its `credentials` — so the change takes effect
 * immediately without a key rotation (change add-seaweedfs-tenant-identities §7).
 * Fail-closed on an unscoped/wildcard/actionless target; throws
 * `IDENTITY_NOT_FOUND` if the identity does not exist (no implicit create).
 *
 * @param {{name:string, actions:string[], buckets:string[]}} input
 * @param {object} [opts]
 * @returns {Promise<{name:string, actions:string[]}>}
 */
export async function updateIdentityActions(input = {}, opts = {}) {
  const name = assertNonEmptyString(input.name, 'identity name');
  const buckets = Array.isArray(input.buckets) ? input.buckets.map((b) => (typeof b === 'string' ? b.trim() : b)) : input.buckets;
  assertScopedIdentity({ buckets, actions: input.actions }); // fail-closed before any I/O
  const transport = resolveTransport(opts);

  const scopedActions = [];
  for (const action of input.actions) {
    for (const bucket of buckets) scopedActions.push(`${action}:${bucket}`);
  }

  return withRetry(async () => {
    const current = await transport.readIdentities();
    if (!current.some((entry) => entry?.name === name)) {
      throw iamError(SEAWEEDFS_IAM_ERROR_CODES.IDENTITY_NOT_FOUND, `Cannot update actions: SeaweedFS identity '${name}' not found.`);
    }
    const next = current.map((entry) => (entry?.name === name ? { ...entry, actions: scopedActions } : entry));
    await transport.writeIdentities(next);
    if (typeof transport.reload === 'function') await transport.reload();
    return { name, actions: scopedActions };
  }, opts).catch((error) => {
    if (NON_RETRYABLE_CODES.has(error?.code)) throw error;
    throw iamError(SEAWEEDFS_IAM_ERROR_CODES.IAM_WRITE_FAILED, `Failed to update SeaweedFS identity actions '${name}': ${error.message}`, error);
  });
}
