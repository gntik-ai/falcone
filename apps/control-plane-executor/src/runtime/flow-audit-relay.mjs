import { setFlowAuditBacklog } from './metrics-registry.mjs';

export async function withFlowAuditTransaction(pool, mutate, eventForResult, transactionalStore) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await mutate(transactionalStore(client));
    const event = eventForResult(result);
    try {
      await client.query('INSERT INTO flow_audit_outbox (event_id, event_payload) VALUES ($1, $2)',
        [event.eventId, event]);
    } catch {
      throw Object.assign(new Error('Flow audit is unavailable; retry the mutation'),
        { statusCode: 503, code: 'AUDIT_UNAVAILABLE' });
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const bounded = (value, fallback, low, high) => Math.max(low, Math.min(high, Number(value) || fallback));

// A row lock spans the Kafka acknowledgement and the status update. SKIP LOCKED lets replicas
// drain distinct rows. A crash after acknowledgement can replay the same eventId; consumers can
// deduplicate on that stable ID without losing an event.
export function createFlowAuditRelay({ pool, publish, intervalMs = 1000, maxAttempts = 12, backoffCapMs = 60000, onBacklog = setFlowAuditBacklog }) {
  intervalMs = bounded(intervalMs, 1000, 100, 60000);
  maxAttempts = bounded(maxAttempts, 12, 1, 100);
  backoffCapMs = bounded(backoffCapMs, 60000, 1000, 3600000);
  let timer;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT event_id, event_payload, attempts
          FROM flow_audit_outbox
          WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
          ORDER BY next_attempt_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const row = rows[0];
        if (row) {
          try {
            await publish(row.event_payload);
            await client.query('UPDATE flow_audit_outbox SET delivered_at = now() WHERE event_id = $1', [row.event_id]);
          } catch {
            const attempts = row.attempts + 1;
            const delay = Math.min(backoffCapMs, 1000 * 2 ** Math.min(attempts - 1, 30));
            await client.query(`UPDATE flow_audit_outbox SET attempts = $2,
              failed_at = CASE WHEN $2 >= $3 THEN now() ELSE NULL END,
              next_attempt_at = now() + ($4::integer * interval '1 millisecond')
              WHERE event_id = $1`, [row.event_id, attempts, maxAttempts, delay]);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const { rows } = await pool.query(`SELECT
        count(*) FILTER (WHERE delivered_at IS NULL AND failed_at IS NULL)::integer AS pending,
        count(*) FILTER (WHERE failed_at IS NOT NULL)::integer AS failed
        FROM flow_audit_outbox`);
      onBacklog(rows[0]);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { void tick().catch(() => {}); }, intervalMs);
    timer.unref?.();
    void tick().catch(() => {});
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { tick, start, stop };
}
