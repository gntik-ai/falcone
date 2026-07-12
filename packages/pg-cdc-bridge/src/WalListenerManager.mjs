import { PgWalListener } from './PgWalListener.mjs';
import { WalEventDecoder } from './WalEventDecoder.mjs';
import { RouteFilter } from './RouteFilter.mjs';
import { CaptureConfigCache } from './CaptureConfigCache.mjs';
import { KafkaChangePublisher } from './KafkaChangePublisher.mjs';
export class WalListenerManager {
  constructor({ pool, kafka, decoderFactory, routeFilterFactory, publisherFactory, metricsCollector, connectionString = process.env.DATABASE_URL }) {
    this.pool = pool; this.kafka = kafka; this.decoderFactory = decoderFactory; this.routeFilterFactory = routeFilterFactory; this.publisherFactory = publisherFactory; this.metricsCollector = metricsCollector; this.connectionString = connectionString; this._listeners = new Map();
  }
  async _startListener(dataSourceRef, tenantId) {
    const cache = new CaptureConfigCache({ pool: this.pool });
    const decoder = this.decoderFactory ? this.decoderFactory() : new WalEventDecoder();
    const routeFilter = this.routeFilterFactory ? this.routeFilterFactory(cache) : new RouteFilter(cache);
    const publisher = this.publisherFactory ? this.publisherFactory() : new KafkaChangePublisher({ kafka: this.kafka, metricsCollector: this.metricsCollector });
    if (!publisher.connected) await publisher.initialize?.();
    const listener = new PgWalListener({ connectionString: this.connectionString, dataSourceRef, tenantId, decoder, routeFilter, publisher });
    await listener.start();
    this._listeners.set(dataSourceRef, { listener, backoffMs: 1000, publisher, tenantId });
  }
  async start() {
    // Resolve the owning tenant for each data source (a data_source_ref belongs to
    // exactly one tenant) so capture-config reads are tenant-scoped downstream.
    const { rows } = await this.pool.query(`SELECT DISTINCT data_source_ref, tenant_id FROM pg_capture_configs WHERE status = 'active'`);
    for (const row of rows) await this._startListener(row.data_source_ref, row.tenant_id);
  }
  _scheduleReconnect(dataSourceRef, tenantId, backoffMs = 1000) { setTimeout(() => this._startListener(dataSourceRef, tenantId).catch(() => this._scheduleReconnect(dataSourceRef, tenantId, Math.min(backoffMs * 2, 60000))), backoffMs); }
  async stop() { await Promise.all([...this._listeners.values()].map(async ({ listener, publisher }) => { await listener.stop(); await publisher.disconnect?.(); })); this._listeners.clear(); }
  health() { return [...this._listeners.entries()].map(([dataSourceRef, { listener }]) => ({ dataSourceRef, isRunning: listener.isRunning })); }
}
