// Control-plane service entrypoint (container CMD).
//
// Wires the connection registry + HTTP server and listens. Phase 0 uses a shared-database
// connection strategy: every workspace resolves to the configured data DSN, queried as the
// non-superuser application role (per-workspace DSNs from the data-plane provisioner are the
// tracked follow-up in add-workspace-db-connection-registry). Connection details come from
// the environment so no secrets are baked into the image.
import pg from 'pg';
import { createConnectionRegistry } from './connection-registry.mjs';
import { createControlPlaneServer } from './server.mjs';
import { createApiKeyStore } from './api-keys.mjs';
import { createMongoExecutor } from './mongo-data-executor.mjs';
import { createEventsExecutor } from './events-executor.mjs';

const { Pool } = pg;
const PORT = Number(process.env.PORT ?? 8080);

function mongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const host = process.env.MONGO_HOST;
  if (!host) return undefined; // Mongo disabled when no URI/host configured
  const auth = process.env.MONGO_USER ? `${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD ?? ''}@` : '';
  return `mongodb://${auth}${host}`;
}

function dataDsn() {
  if (process.env.DATA_DB_URL) return process.env.DATA_DB_URL;
  if (process.env.DB_URL) return process.env.DB_URL;
  const user = process.env.PGUSER ?? 'falcone_app';
  const pw = process.env.PGPASSWORD ?? '';
  const host = process.env.PGHOST ?? 'localhost';
  const port = process.env.PGPORT ?? '5432';
  const db = process.env.PGDATABASE ?? 'falcone';
  const auth = pw ? `${user}:${pw}` : user;
  return `postgres://${auth}@${host}:${port}/${db}`;
}

const dsn = dataDsn();
const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn }) });

// API-key store on the control-plane metadata DB (defaults to the data DSN for now).
const keyPool = new Pool({ connectionString: process.env.CONTROL_DB_URL ?? dsn, max: 4 });
const apiKeyStore = createApiKeyStore({ pool: keyPool });

// Mongo executor (enabled when a MONGO_URI/MONGO_HOST is configured).
const mUri = mongoUri();
const mongoExecutor = mUri ? createMongoExecutor({ resolveUri: () => mUri }) : undefined;

// Events executor (enabled when KAFKA_BROKERS is configured).
const eventsExecutor = process.env.KAFKA_BROKERS ? createEventsExecutor({ brokers: process.env.KAFKA_BROKERS }) : undefined;

const server = createControlPlaneServer({ registry, apiKeyStore, mongoExecutor, eventsExecutor });

apiKeyStore.ensureSchema()
  .catch((error) => console.error('[control-plane] api-key schema init failed:', error))
  .finally(() => {
    server.listen(PORT, () => console.log(`[control-plane] listening on :${PORT}`));
  });

async function shutdown(signal) {
  console.log(`[control-plane] ${signal} received, shutting down`);
  server.close(() => {});
  await registry.end().catch(() => {});
  await keyPool.end().catch(() => {});
  await mongoExecutor?.close().catch(() => {});
  await eventsExecutor?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
