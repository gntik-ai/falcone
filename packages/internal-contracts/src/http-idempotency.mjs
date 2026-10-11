import { createHash, randomUUID } from 'node:crypto';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_HEADERS = new Set(['content-range', 'accept-ranges', 'etag', 'location', 'retry-after', 'x-correlation-id']);
export const DEFAULT_RESPONSE_CAP = 256 * 1024;

export function requestFingerprint(method, url, rawBody) {
  const target = new URL(url, 'http://idempotency.local');
  target.searchParams.sort();
  const path = (target.pathname.replace(/\/$/, '') || '/') + target.search;
  return createHash('sha256').update(`${method.toUpperCase()}\n${path}\n`).update(rawBody).digest('hex');
}

// Explicit route metadata can disable body storage. Also fail safe for credentials and opaque
// invocations that can return secret material supplied by a tenant workload.
export function replayUnavailableRoute(path, route = {}) {
  return route.idempotencyReplay === false
    || /\/(?:api-keys|credentials|credential-[^/]+|secrets|service-accounts|clients|federation|invitations)(?:\/|$)/i.test(path)
    || /\/(?:rotate-secret|credential-resets|credential-rotations|token[^/]*|invocations|invoke|rpc|tools\/[^/]+\/calls)(?:\/|$)/i.test(path)
    || /^\/v1\/storage\//.test(path)
    || /\/workspaces\/[^/]+\/database(?:\/|$)/.test(path)
    || /^\/v1\/functions\/actions\/[^/]+\/activations\/[^/]+\/rerun$/.test(path)
    || /^\/v1\/auth\//.test(path);
}

function containsCredential(body) {
  if (!body || typeof body !== 'object') return false;
  return Object.entries(body).some(([name, value]) =>
    /(?:secret|password|credential|private.?key|token|authorization|cookie|api.?key|^key$|^dsn$|^connection$)/i.test(name)
    || containsCredential(value));
}

function response(statusCode, code, headers = {}) {
  return { statusCode, body: { code, message: code }, headers };
}

/** Reserve before dispatch. All durable state is Postgres-backed and shared by HTTP replicas. */
export async function reserveHttpRequest({ pool, key, method, url, rawBody, tenantId, principalId, route = {}, maxResponseBytes = process.env.IDEMPOTENCY_MAX_RESPONSE_BYTES } = {}) {
  if (!MUTATIONS.has(method) || key === undefined || route.stream || route.sse || route.noAuth || route.auth === 'public' || route.proxy) return null;
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) return { response: response(400, 'INVALID_IDEMPOTENCY_KEY') };
  if (!pool || !principalId) return { response: response(503, 'IDEMPOTENCY_UNAVAILABLE') };
  const scope = [tenantId ?? '', principalId, key];
  const token = randomUUID();
  const fingerprint = requestFingerprint(method, url, rawBody);
  let record;
  // A release/purge between conflict and SELECT is harmless: retry the atomic insert.
  for (let attempt = 0; attempt < 3; attempt++) {
    const won = await pool.query(`INSERT INTO public.http_idempotency_records
      (tenant_id, principal_id, idempotency_key, reservation_id, fingerprint, state, expires_at)
      VALUES ($1,$2,$3,$4,$5,'in_progress',clock_timestamp() + interval '24 hours')
      ON CONFLICT (tenant_id, principal_id, idempotency_key) DO UPDATE SET
        reservation_id=EXCLUDED.reservation_id, fingerprint=EXCLUDED.fingerprint,
        state='in_progress', expires_at=EXCLUDED.expires_at, response_status=NULL,
        response_body=NULL, response_headers=NULL, replay_available=false
      WHERE http_idempotency_records.expires_at <= clock_timestamp()
      RETURNING reservation_id`, [...scope, token, fingerprint]);
    if (won.rows.length) { record = null; break; }
    record = (await pool.query(`SELECT fingerprint, state, response_status, response_body,
      response_headers, replay_available FROM public.http_idempotency_records
      WHERE tenant_id=$1 AND principal_id=$2 AND idempotency_key=$3 AND expires_at > clock_timestamp()`, scope)).rows[0];
    if (record) break;
    if (attempt === 2) return { response: response(409, 'IDEMPOTENCY_KEY_IN_PROGRESS', { 'Retry-After': '1' }) };
  }
  if (record) {
    if (record.fingerprint !== fingerprint) return { response: response(422, 'IDEMPOTENCY_KEY_MISMATCH') };
    if (record.state === 'in_progress') return { response: response(409, 'IDEMPOTENCY_KEY_IN_PROGRESS', { 'Retry-After': '1' }) };
    if (!record.replay_available) return { response: response(409, 'IDEMPOTENCY_REPLAY_UNAVAILABLE') };
    return { response: { statusCode: record.response_status,
      body: record.response_body ? JSON.parse(record.response_body) : null,
      headers: { ...record.response_headers, 'X-Idempotency-Replayed': 'true' } } };
  }
  // Bounded opportunistic cleanup; another caller's active reservation is never deleted early.
  await pool.query(`DELETE FROM public.http_idempotency_records WHERE expires_at <= clock_timestamp() AND ctid IN
    (SELECT ctid FROM public.http_idempotency_records WHERE expires_at <= clock_timestamp() LIMIT 100)`).catch(() => {});
  let settled = false;
  const cap = Number(maxResponseBytes);
  const responseCap = Number.isSafeInteger(cap) && cap > 0 ? cap : DEFAULT_RESPONSE_CAP;
  const unavailable = replayUnavailableRoute(new URL(url, 'http://idempotency.local').pathname, route);
  return {
    async release() {
      if (settled) return;
      await pool.query(`DELETE FROM public.http_idempotency_records
        WHERE tenant_id=$1 AND principal_id=$2 AND idempotency_key=$3 AND reservation_id=$4`, [...scope, token]);
      settled = true;
    },
    async complete({ statusCode, body, headers = {} }) {
      if (statusCode >= 500) return this.release();
      // Once a final result exists, failure to record it must leave the reservation blocking
      // retries. Releasing here could repeat a side effect whose response was lost.
      settled = true;
      const payload = statusCode === 204 || body == null ? '' : JSON.stringify(body);
      const available = !unavailable && !containsCredential(body) && Buffer.byteLength(payload) <= responseCap;
      const safeHeaders = Object.fromEntries(Object.entries(headers)
        .filter(([name]) => SAFE_HEADERS.has(name.toLowerCase()))
        .map(([name, value]) => [name.toLowerCase(), String(value)]));
      await pool.query(`UPDATE public.http_idempotency_records SET state='completed',
        response_status=$5, response_body=$6, response_headers=$7::jsonb, replay_available=$8
        WHERE tenant_id=$1 AND principal_id=$2 AND idempotency_key=$3 AND reservation_id=$4`,
      [...scope, token, statusCode, available ? payload : null, JSON.stringify(safeHeaders), available]);
    },
  };
}
