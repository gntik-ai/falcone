import pg from 'pg';
import { Kafka } from 'kafkajs';
import { MongoCaptureConfigCache } from './MongoCaptureConfigCache.mjs';
import { ResumeTokenStore } from './ResumeTokenStore.mjs';
import { KafkaChangePublisher, assertValidTopicNamespace } from './KafkaChangePublisher.mjs';
assertValidTopicNamespace(process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX);
import { ChangeStreamManager } from './ChangeStreamManager.mjs';
import { CollectionCatalog } from './CollectionCatalog.mjs';
import { MetricsCollector } from './MetricsCollector.mjs';
import { HealthServer } from './HealthServer.mjs';
import { withPostgresSsl, resolveKafkaSecurity } from '../../internal-contracts/src/transport-security.mjs';
const { Pool } = pg;

if (!process.env.MONGO_CDC_PG_CONNECTION_STRING) throw new Error('MONGO_CDC_PG_CONNECTION_STRING_REQUIRED');
if (!process.env.MONGO_CDC_KAFKA_BROKERS) throw new Error('MONGO_CDC_KAFKA_BROKERS_REQUIRED');
// The DocumentDB engine (FerretDB backend) is a SEPARATE Postgres from the bridge metadata DB above:
// it holds the document rows and the logical replication slot. Requires a REPLICATION-privileged role
// (distinct from falcone_app) — provisioned by the chart (#460 task 2.4).
if (!process.env.MONGO_CDC_DOCUMENTDB_URL) throw new Error('MONGO_CDC_DOCUMENTDB_URL_REQUIRED');

const pool = new Pool(withPostgresSsl({ connectionString: process.env.MONGO_CDC_PG_CONNECTION_STRING }));
const enginePool = new Pool(withPostgresSsl({ connectionString: process.env.MONGO_CDC_DOCUMENTDB_URL }));
const engineConnectionConfig = withPostgresSsl({ connectionString: process.env.MONGO_CDC_DOCUMENTDB_URL });
const kafka = new Kafka({ clientId: process.env.MONGO_CDC_KAFKA_CLIENT_ID ?? 'mongo-cdc-bridge', brokers: process.env.MONGO_CDC_KAFKA_BROKERS.split(',').filter(Boolean), ...resolveKafkaSecurity() });
const metricsCollector = new MetricsCollector();
const kafkaPublisher = new KafkaChangePublisher({ kafka, metricsCollector });
await kafkaPublisher.connect();
const configCache = new MongoCaptureConfigCache({ pool, ttlSeconds: Number(process.env.MONGO_CDC_CACHE_TTL_SECONDS ?? 30) });
const resumeTokenStore = new ResumeTokenStore(pool);
const manager = new ChangeStreamManager({
  pool,
  enginePool,
  engineConnectionConfig,
  publicationName: process.env.MONGO_CDC_PUBLICATION ?? 'falcone_cdc_pub',
  catalog: new CollectionCatalog(enginePool),
  configCache,
  resumeTokenStore,
  kafkaPublisher,
  statusUpdater: async (captureId, status, lastError) => pool.query('UPDATE mongo_capture_configs SET status=$2, last_error=$3, updated_at=now() WHERE id=$1', [captureId, status, lastError]),
  auditCallback: async (action, config, _rawDoc, detail) => pool.query('INSERT INTO mongo_capture_audit_log (capture_id, tenant_id, workspace_id, actor_identity, action, after_state) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [config.id, config.tenant_id, config.workspace_id, config.actor_identity, action, JSON.stringify(detail ?? null)])
});
const healthServer = new HealthServer({ port: Number(process.env.MONGO_CDC_HEALTH_PORT ?? 8080), manager, metricsCollector });
await manager.start();
healthServer.start();
const shutdown = async () => { await manager.shutdown(); await healthServer.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
