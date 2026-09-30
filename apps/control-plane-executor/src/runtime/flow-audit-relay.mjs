import { recordFlowAuditRelaySuccess, setFlowAuditBacklog } from './metrics-registry.mjs';

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
export function createFlowAuditRelay({ pool, publish, intervalMs = 1000, maxAttempts,
  backoffCapMs = 60000, retryWindowMs = 7 * 24 * 60 * 60 * 1000,
  batchSize = 100, retentionDays = 30, onBacklog = setFlowAuditBacklog,
  onSuccess = recordFlowAuditRelaySuccess }) {
  intervalMs = bounded(intervalMs, 1000, 100, 60000);
  backoffCapMs = bounded(backoffCapMs, 60000, 1000, 3600000);
  retryWindowMs = bounded(retryWindowMs, 7 * 24 * 60 * 60 * 1000, 60000, 30 * 24 * 60 * 60 * 1000);
  // Budget for the requested outage window even after backoff reaches its cap.
  maxAttempts = bounded(maxAttempts,
    Math.ceil(retryWindowMs / backoffCapMs) + Math.ceil(Math.log2(backoffCapMs / 1000)) + 2,
    1, 1000000);
  batchSize = bounded(batchSize, 100, 1, 500);
  retentionDays = bounded(retentionDays, 30, 1, 365);
  let timer;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const client = await pool.connect();
      try {
        // Commit each row separately so a slow Kafka send never holds the entire batch.
        for (let i = 0; i < batchSize; i += 1) {
          await client.query('BEGIN');
          try {
            const { rows } = await client.query(`SELECT event_id, event_payload, attempts
              FROM flow_audit_outbox
              WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
              ORDER BY next_attempt_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
            const row = rows[0];
            if (!row) {
              await client.query('COMMIT');
              break;
            }
            let publishFailed = false;
            try {
              await publish(row.event_payload);
            } catch {
              publishFailed = true;
            }
            if (publishFailed) {
              const attempts = row.attempts + 1;
              const delay = Math.min(backoffCapMs, 1000 * 2 ** Math.min(attempts - 1, 30));
              await client.query(`UPDATE flow_audit_outbox SET attempts = $2,
                failed_at = CASE WHEN $2 >= $3 THEN now() ELSE NULL END,
                next_attempt_at = now() + ($4::integer * interval '1 millisecond')
                WHERE event_id = $1`, [row.event_id, attempts, maxAttempts, delay]);
            } else {
              await client.query('UPDATE flow_audit_outbox SET delivered_at = now() WHERE event_id = $1', [row.event_id]);
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          }
        }
      } finally {
        client.release();
      }
      // Keep delivered rows for investigation, then purge only a bounded, indexed slice.
      await pool.query(`DELETE FROM flow_audit_outbox WHERE event_id IN (
        SELECT event_id FROM flow_audit_outbox
        WHERE delivered_at < now() - ($1::integer * interval '1 day')
        ORDER BY delivered_at LIMIT $2)`, [retentionDays, batchSize]);
      const [pending, failed] = await Promise.all([
        pool.query(`SELECT count(*)::integer AS count FROM flow_audit_outbox
          WHERE delivered_at IS NULL AND failed_at IS NULL`),
        pool.query(`SELECT count(*)::integer AS count FROM flow_audit_outbox
          WHERE failed_at IS NOT NULL`),
      ]);
      onBacklog({ pending: pending.rows[0].count, failed: failed.rows[0].count });
      onSuccess();
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
