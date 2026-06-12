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
import { createRealtimeExecutor } from './realtime-executor.mjs';
import { createPostgresRealtimeExecutor } from './postgres-realtime-executor.mjs';
import { createEventsExecutor } from './events-executor.mjs';
import { createFunctionsExecutor } from './functions-executor.mjs';
import { createEmbeddingProviderStore, createEmbeddingExecutor, createEmbeddingMappingStore } from './embedding-executor.mjs';
import { createFlowExecutor, createFlowStore } from './flow-executor.mjs';
import { createFlowQuotaGate } from './flow-quota-gate.mjs';
import { createJwtVerifier } from './jwt-verify.mjs';
// Temporal-FREE list of first-party task-type names (add-flows-activity-catalog / #360).
// Feeds the flows validate/publish endpoints' FLW-E006 check so a flow definition that
// references an unknown taskType is rejected (422 FLOW_VALIDATION_FAILED). The full activity
// registry (with @temporalio/activity) lives in the worker; only the names cross here.
import { TASK_TYPE_NAMES } from '../../../../services/workflow-worker/src/activities/catalog-names.mjs';

const { Pool } = pg;
const PORT = Number(process.env.PORT ?? 8080);

function mongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const host = process.env.MONGO_HOST;
  if (!host) return undefined; // Mongo disabled when no URI/host configured
  const auth = process.env.MONGO_USER ? `${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD ?? ''}@` : '';
  // When authenticating, default the auth db to admin (where root users live, e.g. Bitnami);
  // override with MONGO_AUTH_SOURCE.
  const authSource = process.env.MONGO_USER ? `/?authSource=${process.env.MONGO_AUTH_SOURCE ?? 'admin'}` : '';
  return `mongodb://${auth}${host}${authSource}`;
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
const resolveConnection = () => ({ dsn });
const registry = createConnectionRegistry({ resolveConnection });

// Postgres realtime executor (trigger + LISTEN/NOTIFY; needs a connection that can create
// the capture trigger — the executor's role is a superuser in the data plane).
const pgRealtimeExecutor = createPostgresRealtimeExecutor({ resolveConnection });

// API-key store on the control-plane metadata DB (defaults to the data DSN for now).
const keyPool = new Pool({ connectionString: process.env.CONTROL_DB_URL ?? dsn, max: 4 });
const apiKeyStore = createApiKeyStore({ pool: keyPool });

// Embedding-provider executor (in-platform embedding for KNN queryText). The provider
// store is Postgres-backed on the SAME metadata pool as the API-key store, so provider
// configuration survives a restart and is shared across all control-plane replicas.
// secretResolver bridges a stored secretRef to the actual key value: ESO/Vault mounts the
// resolved secret as an env var named by secretRef.name (no plaintext is ever persisted).
const embeddingStore = createEmbeddingProviderStore({ pool: keyPool });
const embeddingExecutor = createEmbeddingExecutor({
  store: embeddingStore,
  secretResolver: (secretRef) => {
    if (secretRef?.name) return Promise.resolve(process.env[secretRef.name] ?? null);
    return Promise.resolve(null);
  },
});

// Per-collection embedding mapping store (write-time auto-embedding). Postgres-backed on the
// SAME metadata pool as the API-key + provider stores, so mapping configuration survives a
// restart and is shared across all control-plane replicas. keyPool.end() in shutdown() covers it.
const mappingStore = createEmbeddingMappingStore({ pool: keyPool });

// Mongo executor (enabled when a MONGO_URI/MONGO_HOST is configured).
const mUri = mongoUri();
const mongoExecutor = mUri ? createMongoExecutor({ resolveUri: () => mUri }) : undefined;

// Realtime executor (Mongo change streams; needs a replica set). Enabled with Mongo.
const realtimeExecutor = mUri ? createRealtimeExecutor({ resolveUri: () => mUri }) : undefined;

// Events executor (enabled when KAFKA_BROKERS is configured).
const eventsExecutor = process.env.KAFKA_BROKERS ? createEventsExecutor({ brokers: process.env.KAFKA_BROKERS }) : undefined;

// Functions executor. Default backend is the local worker_threads runner (DEV/TEST only —
// runs user code in-thread); production injects a Knative backend (FN_BACKEND=knative).
const functionsExecutor = process.env.FN_BACKEND === 'off' ? undefined : createFunctionsExecutor();

// Bearer-JWT verifier (Keycloak/OIDC). Enabled when KEYCLOAK_JWKS_URL is set; lets the
// executor authenticate admin/user requests directly (e.g. API-key issuance) without the
// gateway injecting x-tenant-id. Unset → the executor trusts gateway-injected identity headers.
const jwtVerifier = createJwtVerifier({
  jwksUrl: process.env.KEYCLOAK_JWKS_URL,
  issuer: process.env.KEYCLOAK_ISSUER,
  audience: process.env.KEYCLOAK_AUDIENCE,
});

// Flow executor (Temporal-backed flows API). Enabled ONLY when TEMPORAL_ADDRESS is configured;
// it is the SOLE holder of the Temporal client (lazy-connect). Definitions/versions persist on
// the SAME metadata pool as the API-key + embedding stores (design.md OQ1). When unset, no flows
// routes are registered and a flows path falls through to 404 / upstream proxy unchanged.
// Flow quota gate (change: add-flows-tenancy-isolation-limits). Wired only when a quota
// evaluator endpoint is configured (FLOW_QUOTA_ENFORCE_URL); the evaluator calls the
// provisioning-orchestrator quota-enforce action over HTTP and maps a hard-limit decision to a
// 429. When unset the flows API is unmetered (dev/test) — a breach never silently allows in prod
// because production always sets the URL.
const flowQuotaGate = process.env.FLOW_QUOTA_ENFORCE_URL
  ? createFlowQuotaGate({
      evaluate: async ({ dimensionKey, tenantId, workspaceId, currentUsage }) => {
        const res = await fetch(process.env.FLOW_QUOTA_ENFORCE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dimensionKey, tenantId, workspaceId, currentUsage }),
        });
        if (!res.ok) throw Object.assign(new Error(`quota evaluator ${res.status}`), { status: res.status });
        return res.json();
      },
    })
  : undefined;

// Flow audit sink (change: add-flows-tenancy-isolation-limits). Best-effort: emits each flow
// lifecycle event to the audit Kafka topic via the events executor when configured; otherwise a
// no-op (definitions/executions still work; production wires Kafka). NEVER fails a flow request.
const flowAuditTopic = process.env.FLOW_AUDIT_TOPIC ?? 'falcone.audit.flow-lifecycle';
const flowAuditSink = eventsExecutor
  ? async (event) => {
      try {
        await eventsExecutor.executeEvents({
          operation: 'publish', topic: flowAuditTopic,
          identity: { tenantId: event.tenantId, workspaceId: event.workspaceId },
          payload: { messages: [{ key: event.tenantId, value: event }] },
        });
      } catch (err) { console.error('[control-plane] flow audit publish failed:', err?.message ?? err); }
    }
  : undefined;

const flowExecutor = process.env.TEMPORAL_ADDRESS
  ? createFlowExecutor({
      store: createFlowStore({ pool: keyPool }),
      temporalAddress: process.env.TEMPORAL_ADDRESS,
      temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'falcone-flows',
      temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'flows-main',
      // Enforce FLW-E006: validate/publish reject any taskType not in the catalog.
      taskTypeCatalog: TASK_TYPE_NAMES,
      quotaGate: flowQuotaGate,
      auditSink: flowAuditSink,
    })
  : undefined;

// When the executor fronts the data-family wildcard (gateway route-split), it serves the
// data-plane + DDL slice itself and proxies every other path under those prefixes
// (browse/inventory/management) to the legacy control-plane at CONTROL_PLANE_UPSTREAM.
// Unset → unmatched paths return 404 (standalone/pure-executor mode).
const server = createControlPlaneServer({
  registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor, embeddingExecutor, mappingStore, flowExecutor, jwtVerifier,
  controlPlaneUpstream: process.env.CONTROL_PLANE_UPSTREAM,
});

// Initialise all metadata schemas (they share keyPool) before listening.
Promise.all([apiKeyStore.ensureSchema(), embeddingStore.ensureSchema(), mappingStore.ensureSchema(), flowExecutor?.ensureSchema() ?? Promise.resolve()])
  .catch((error) => console.error('[control-plane] metadata schema init failed:', error))
  .finally(() => {
    server.listen(PORT, () => console.log(`[control-plane] listening on :${PORT}`));
  });

async function shutdown(signal) {
  console.log(`[control-plane] ${signal} received, shutting down`);
  server.close(() => {});
  await registry.end().catch(() => {});
  // keyPool backs BOTH apiKeyStore and embeddingStore; ending it once covers both.
  await keyPool.end().catch(() => {});
  await mongoExecutor?.close().catch(() => {});
  await realtimeExecutor?.close().catch(() => {});
  await pgRealtimeExecutor?.close().catch(() => {});
  await eventsExecutor?.close().catch(() => {});
  await flowExecutor?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
