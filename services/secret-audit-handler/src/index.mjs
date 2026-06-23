import { createLogTailer } from './vault-log-reader.mjs';
import { sanitize } from './sanitizer.mjs';
import { createPublisher } from './kafka-publisher.mjs';

// OpenBao's file-audit device path. Reads the canonical BAO_AUDIT_LOG_PATH first, falling back to
// the legacy VAULT_AUDIT_LOG_PATH so existing configuration keeps working after the Vault -> OpenBao
// swap. OpenBao's file-audit JSON is Vault-schema-compatible, so vault-log-reader.mjs is unchanged.
const filePath = process.env.BAO_AUDIT_LOG_PATH ?? process.env.VAULT_AUDIT_LOG_PATH ?? '/openbao/audit/openbao-audit.log';
const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean);
const topic = process.env.SECRET_AUDIT_KAFKA_TOPIC ?? 'console.secrets.audit';

if (brokers.length === 0) {
  console.error('KAFKA_BROKERS is required');
  process.exit(1);
}

const publisher = await createPublisher({ brokers, topic });

try {
  await publisher.connect();
} catch (error) {
  console.error('Kafka connection failed', error);
  process.exit(1);
}

const shutdown = async () => {
  await publisher.disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

for await (const entry of createLogTailer(filePath)) {
  const cleaned = sanitize(entry);
  await publisher.publishAuditEvent(cleaned);
}
