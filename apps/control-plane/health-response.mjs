// Keep readiness tied to Postgres. Secret-backend auth is reported in the body and metrics so
// a secrets-only outage does not remove the control-plane API from Service endpoints.
export async function respondHealth(res, { pool, secretBackendHealth, sendJson, log = console.error }) {
  const secretBackend = secretBackendHealth();
  try {
    await pool.query('SELECT 1');
    return sendJson(res, 200, { status: 'ok', secretBackend });
  } catch (error) {
    log('[control-plane] healthz db check failed:', error);
    return sendJson(res, 503, { status: 'db_unavailable', secretBackend });
  }
}
