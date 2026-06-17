// Live-campaign test client. Talks to the running Falcone kind deployment through
// port-forwards (see lib/portforward.sh). No secrets are hard-coded: credentials come
// from env vars that creds.sh injects by reading the specific platform secrets.
//
// Surfaces:
//  - gateway REST  : FALCONE_GATEWAY (APISIX :9080)  -> control-plane (JWT) / executor (apikey)
//  - keycloak OIDC : FALCONE_KEYCLOAK (:8080), realm FALCONE_REALM
//  - direct PG     : FALCONE_PG_* (psql/pg)
//  - direct FerretDB: FALCONE_MONGO (mongodb wire)
//  - direct S3     : FALCONE_S3 + FALCONE_S3_ACCESS/SECRET (SeaweedFS)

const GATEWAY = process.env.FALCONE_GATEWAY || 'http://localhost:9080';

let _cid = 0;
export const corrId = (p = 'camp') => `${p}-${Date.now()}-${++_cid}`;

/** Low-level gateway call. auth = {token} (Bearer JWT) or {apikey} (flc_ data-plane key). */
export async function api(method, path, { token, apikey, body, headers = {}, raw = false } = {}) {
  const h = {
    'X-Correlation-Id': corrId(),
    'X-API-Version': '2026-03-26',
    ...headers,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  if (apikey) h.apikey = apikey;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !h['Idempotency-Key']) {
    h['Idempotency-Key'] = corrId('idem');
  }
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, body: payload, headers: res.headers };
}

export const get = (p, o) => api('GET', p, o);
export const post = (p, body, o = {}) => api('POST', p, { ...o, body });
export const put = (p, body, o = {}) => api('PUT', p, { ...o, body });
export const del = (p, o) => api('DELETE', p, o);

/**
 * Mint a session token via the REAL console flow (control-plane brokers Keycloak ROPC).
 * POST /v1/auth/login-sessions {usernameOrEmail/username, password}. Returns the raw body
 * so callers can adapt to the exact token field once probed live.
 */
export async function login(username, password, extra = {}) {
  // try the most likely field names; the live probe confirms which the API accepts
  const attempts = [
    { username, password, ...extra },
    { usernameOrEmail: username, password, ...extra },
    { email: username, password, ...extra },
  ];
  let last;
  for (const body of attempts) {
    const r = await post('/v1/auth/login-sessions', body);
    last = r;
    if (r.status >= 200 && r.status < 300) {
      const b = r.body || {};
      const token =
        b.tokenSet?.accessToken || b.tokenSet?.access_token ||
        b.accessToken || b.access_token || b.token ||
        b.session?.accessToken || b.tokens?.accessToken || b.tokens?.access_token;
      return { ok: true, token, raw: b, status: r.status, principal: b.principal };
    }
  }
  return { ok: false, status: last?.status, raw: last?.body };
}

/** Direct Keycloak ROPC (fallback / explicit client). */
export async function ropc({ realm = process.env.FALCONE_REALM || 'in-falcone-platform',
  clientId = process.env.FALCONE_CONSOLE_CLIENT || 'in-falcone-console',
  clientSecret, username, password } = {}) {
  const kc = process.env.FALCONE_KEYCLOAK || 'http://localhost:8080';
  const p = new URLSearchParams();
  p.set('grant_type', 'password');
  p.set('client_id', clientId);
  if (clientSecret) p.set('client_secret', clientSecret);
  p.set('username', username);
  p.set('password', password);
  p.set('scope', 'openid');
  const res = await fetch(`${kc}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: p,
  });
  const b = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, token: b.access_token, raw: b };
}

/** Decode a JWT payload (no verification) for asserting claims (tenant_id, roles…). */
export function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
  catch { return null; }
}

/** Direct Postgres pool (bypasses the API). Uses FALCONE_PG_* env. */
export async function pgPool(overrides = {}) {
  const { default: pg } = await import('pg');
  return new pg.Pool({
    host: process.env.FALCONE_PG_HOST || 'localhost',
    port: +(process.env.FALCONE_PG_PORT || 55432),
    user: process.env.FALCONE_PG_USER || 'falcone',
    password: process.env.FALCONE_PG_PASSWORD,
    database: process.env.FALCONE_PG_DB || 'in_falcone',
    ...overrides,
  });
}

/** Direct FerretDB (mongo wire) client. */
export async function mongoClient(uri = process.env.FALCONE_MONGO || 'mongodb://localhost:57017') {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(uri, { directConnection: true, serverSelectionTimeoutMS: 8000 });
  await c.connect();
  return c;
}

/** Direct S3 (SeaweedFS) client via aws-sdk v3 if available. */
export async function s3Client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    endpoint: process.env.FALCONE_S3 || 'http://localhost:58333',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.FALCONE_S3_ACCESS,
      secretAccessKey: process.env.FALCONE_S3_SECRET,
    },
  });
}

export { GATEWAY };
