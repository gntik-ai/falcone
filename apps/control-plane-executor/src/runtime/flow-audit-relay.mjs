// Platform flow audit outbox relay. A row lock spans publish and acknowledgement so replicas
// never claim the same pending event concurrently. A crash after publish can replay eventId.
import { Kafka, logLevel } from 'kafkajs';
import { resolveKafkaSecurity } from '../../../../packages/internal-contracts/src/transport-security.mjs';
import { recordFlowAuditOutbox } from './metrics-registry.mjs';

const MAX_ATTEMPTS = 12;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;

export function createPlatformFlowAuditProducer({ brokers, topic = 'falcone.audit.flow-lifecycle' }) {
  const kafka = new Kafka({ clientId: 'falcone-flow-audit', brokers: brokers.split(',').map((b) => b.trim()).filter(Boolean),
    logLevel: logLevel.NOTHING, ...resolveKafkaSecurity() });
  let connected;
  async function producer() {
    if (!connected) {
      const instance = kafka.producer();
      connected = instance.connect().then(() => instance).catch((err) => { connected = null; throw err; });
    }
    return connected;
  }
  return {
    async publish(event) {
      await (await producer()).send({ topic, messages: [{ key: event.eventId, value: JSON.stringify(event) }] });
    },
    async close() { if (connected) await (await connected).disconnect().catch(() => {}); },
  };
}

export function createFlowAuditRelay({ pool, publish, logger = console, intervalMs = 1000 }) {
  let timer;
  let running = false;
  let failures = 0;
  async function refreshMetrics() {
    const { rows } = await pool.query(`SELECT
      count(*) FILTER (WHERE state = 'pending')::integer AS pending,
      count(*) FILTER (WHERE state = 'dead_letter')::integer AS dead_letter,
      COALESCE(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE state = 'pending')), 0)::float AS oldest_seconds
      FROM flow_audit_outbox`);
    recordFlowAuditOutbox({ ...rows[0], failures });
  }
  async function runOnce() {
    if (running) return false;
    running = true;
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT event_id, payload, attempts FROM flow_audit_outbox
        WHERE state = 'pending' AND next_attempt_at <= now()
        ORDER BY next_attempt_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const row = rows[0];
      if (!row) {
        await client.query('COMMIT');
        await refreshMetrics();
        return false;
      }
      try {
        await publish(row.payload);
        await client.query(`UPDATE flow_audit_outbox SET state = 'delivered', delivered_at = now(), attempts = attempts + 1
          WHERE event_id = $1`, [row.event_id]);
      } catch (err) {
        failures += 1;
        const attempts = row.attempts + 1;
        const reason = err?.cause ?? err;
        // No error message: Kafka messages may include broker or auth details.
        logger.error?.('[flow-audit-relay] publish failed', {
          eventId: row.event_id, attempts,
          errorClass: String(reason?.code ?? reason?.name ?? 'UNKNOWN').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64),
        });
        const delayMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 20));
        await client.query(`UPDATE flow_audit_outbox SET state = $2, attempts = $3,
          next_attempt_at = now() + ($4::integer * interval '1 millisecond') WHERE event_id = $1`,
        [row.event_id, attempts >= MAX_ATTEMPTS ? 'dead_letter' : 'pending', attempts, delayMs]);
      }
      await client.query('COMMIT');
      await refreshMetrics();
      return true;
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger.error?.('[flow-audit-relay] database failure', { errorClass: String(err?.code ?? err?.name ?? 'UNKNOWN').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64) });
      return false;
    } finally {
      client?.release();
      running = false;
    }
  }
  return {
    runOnce,
    start() { if (!timer) { timer = setInterval(() => { void runOnce(); }, intervalMs); timer.unref?.(); void runOnce(); } },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
