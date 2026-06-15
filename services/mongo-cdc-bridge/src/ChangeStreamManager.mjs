// ChangeStreamManager — re-architected onto Postgres logical replication (change
// add-ferretdb-realtime-cdc-remediation, #460). One pgoutput slot per capture config (slots are
// exclusive) over a shared publication on the DocumentDB engine; each watcher consumes its slot via
// a WalReplicationClient and scopes the all-tenant stream to its (tenant, database, collection).
import { ChangeStreamWatcher } from './ChangeStreamWatcher.mjs';
import { WalReplicationClient } from './WalReplicationClient.mjs';
import { CollectionCatalog } from './CollectionCatalog.mjs';

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

  // documents tables created after this sweep need REPLICA IDENTITY FULL applied by the engine
  // provisioning (event trigger / periodic job) — see the chart provisioning step (#460 task 2).
  async _ensureProvisioning() {
    const { rows: pub } = await this.enginePool.query('SELECT 1 FROM pg_publication WHERE pubname = $1', [this.publicationName]);
    if (!pub.length) await this.enginePool.query(`CREATE PUBLICATION ${this.publicationName} FOR TABLES IN SCHEMA documentdb_data`);
    const { rows: tables } = await this.enginePool.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
        "WHERE n.nspname = 'documentdb_data' AND relname LIKE 'documents_%' AND relkind = 'r'"
    );
    for (const t of tables) await this.enginePool.query(`ALTER TABLE documentdb_data.${t.relname} REPLICA IDENTITY FULL`);
  }

  _slotName(config) {
    const id = String(config.id).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `falcone_cdc_${id}`.slice(0, 63);
  }

  async _ensureSlot(slotName) {
    const { rows } = await this.enginePool.query('SELECT 1 FROM pg_replication_slots WHERE slot_name = $1', [slotName]);
    if (!rows.length) await this.enginePool.query("SELECT pg_create_logical_replication_slot($1, 'pgoutput')", [slotName]);
  }

  async _startWatcher(config) {
    if (this.watchers.has(config.id)) return;
    const slotName = this._slotName(config);
    await this._ensureSlot(slotName);
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
    await this._ensureProvisioning();
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
