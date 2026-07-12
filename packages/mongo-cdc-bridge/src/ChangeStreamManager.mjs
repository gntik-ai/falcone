// ChangeStreamManager — re-architected onto Postgres logical replication (change
// add-ferretdb-realtime-cdc-remediation, #460). One pgoutput slot per capture config (slots are
// exclusive) over a shared publication on the DocumentDB engine; each watcher consumes its slot via
// a WalReplicationClient and scopes the all-tenant stream to its (tenant, database, collection).
import { ChangeStreamWatcher } from './ChangeStreamWatcher.mjs';
import { WalReplicationClient } from './WalReplicationClient.mjs';
import { CollectionCatalog } from './CollectionCatalog.mjs';
import { ensurePublicationAndReplicaIdentity, ensureSlot } from './provisionLogicalReplication.mjs';

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

export class ChangeStreamManager {
  constructor({ pool, enginePool, engineConnectionConfig, publicationName = 'falcone_cdc_pub', catalog, configCache, resumeTokenStore, kafkaPublisher, statusUpdater = async () => {}, auditCallback = async () => {} }) {
    if (!SAFE_IDENT.test(publicationName)) throw new Error(`Unsafe publication name: ${publicationName}`);
    this.pool = pool;
    this.enginePool = enginePool;
    this.configCache = configCache;
    this.engineConnectionConfig = engineConnectionConfig;
    this.publicationName = publicationName;
    this.catalog = catalog ?? new CollectionCatalog(enginePool);
    this.resumeTokenStore = resumeTokenStore;
    this.kafkaPublisher = kafkaPublisher;
    this.statusUpdater = statusUpdater;
    this.auditCallback = auditCallback;
    this.watchers = new Map();
  }

  _slotName(config) {
    const id = String(config.id).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `falcone_cdc_${id}`.slice(0, 63);
  }

  async _startWatcher(config) {
    if (this.watchers.has(config.id)) return;
    const slotName = this._slotName(config);
    // Durable per-config slot: its confirmed LSN is the resume cursor, so create only if missing.
    await ensureSlot(this.enginePool, slotName);
    const walClient = new WalReplicationClient({
      connectionConfig: this.engineConnectionConfig,
      slotName,
      publicationName: this.publicationName,
      catalog: this.catalog,
      autoAck: false // CDC durability: confirmed LSN advances only after Kafka publish + persist
    });
    const watcher = new ChangeStreamWatcher({
      captureConfig: config,
      walClient,
      kafkaPublisher: this.kafkaPublisher,
      resumeTokenStore: this.resumeTokenStore,
      auditCallback: this.auditCallback,
      statusUpdateCallback: async (status, lastError) => this.statusUpdater(config.id, status, lastError)
    });
    this.watchers.set(config.id, watcher);
    watcher.start().catch(() => {});
  }

  async start() {
    await ensurePublicationAndReplicaIdentity(this.enginePool, this.publicationName);
    const configs = await this.configCache.load(true);
    for (const config of configs) await this._startWatcher(config);
    this.configCache.on('added', (config) => { this._startWatcher(config).catch(() => {}); });
    this.configCache.on('removed', (config) => { this.watchers.get(config.id)?.stop?.(); this.watchers.delete(config.id); });
    this.configCache.startPolling();
  }

  getActiveWatchers() { return [...this.watchers.values()]; }

  async shutdown() {
    this.configCache.stopPolling();
    await Promise.all([...this.watchers.values()].map((watcher) => watcher.stop()));
    await this.kafkaPublisher.disconnect();
    await this.enginePool?.end?.().catch?.(() => {});
  }
}
