// ChangeStreamWatcher — re-architected onto Postgres logical replication (change
// add-ferretdb-realtime-cdc-remediation, #460). FerretDB v2 has no MongoDB change streams, so this
// consumes a WalReplicationClient (one pgoutput slot per capture config) instead of
// collection.watch(). For each WAL change it synthesises the raw-change-doc shape that
// MongoChangeEventMapper already expects, publishes the unchanged CloudEvents envelope to Kafka,
// then persists + acknowledges the LSN — only after a durable publish, so the slot never advances
// past an unpublished change (no gaps).
import { isDeepStrictEqual } from 'node:util';

import { map as mapEvent } from './MongoChangeEventMapper.mjs';

// Approximate a MongoDB updateDescription by diffing the old/new full images. A WAL UPDATE always
// carries the full new row (REPLICA IDENTITY FULL) and cannot reveal the exact $set paths, so this
// reports changes at top-level field granularity — sufficient for delta-mode parity.
export function diffImages(before = {}, after = {}) {
  const updatedFields = {};
  const removedFields = [];
  for (const key of Object.keys(after ?? {})) {
    if (!isDeepStrictEqual(after[key], before?.[key])) updatedFields[key] = after[key];
  }
  for (const key of Object.keys(before ?? {})) {
    if (!(key in (after ?? {}))) removedFields.push(key);
  }
  return { updatedFields, removedFields };
}

export class ChangeStreamWatcher {
  constructor({ captureConfig, walClient, kafkaPublisher, resumeTokenStore, auditCallback = async () => {}, statusUpdateCallback = async () => {} }) {
    this.captureConfig = captureConfig;
    this.walClient = walClient;
    this.kafkaPublisher = kafkaPublisher;
    this.resumeTokenStore = resumeTokenStore;
    this.auditCallback = auditCallback;
    this.statusUpdateCallback = statusUpdateCallback;
    this.running = false;
    this.healthy = true;
  }

  _topic() { return this.kafkaPublisher.resolveTopic(this.captureConfig); }
  _partitionKey() { return `${this.captureConfig.workspace_id}:${this.captureConfig.database_name}.${this.captureConfig.collection_name}`; }
  isHealthy() { return this.healthy; }

  // The slot delivers ALL tenants'/collections' rows; scope to this capture config.
  _matches(record) {
    return record.tenantId === this.captureConfig.tenant_id
      && record.database === this.captureConfig.database_name
      && record.collection === this.captureConfig.collection_name;
  }

  // Map a normalized WAL record into the raw-change-doc shape buildMongoChangeEvent consumes.
  _toRawChangeDoc(record) {
    const mode = this.captureConfig.capture_mode ?? 'delta';
    let operationType;
    let fullDocument;
    let updateDescription = null;
    if (record.operationType === 'insert') {
      operationType = 'insert';
      fullDocument = record.fullDocument ?? null;
    } else if (record.operationType === 'delete') {
      operationType = 'delete';
      fullDocument = null;
    } else if (mode === 'delta') {
      // Logical replication cannot distinguish $set from replace; in delta mode synthesise the
      // updateDescription from the pre/post images so downstream parity holds.
      operationType = 'update';
      updateDescription = diffImages(record.fullDocumentBeforeChange, record.fullDocument);
      fullDocument = record.fullDocument ?? null;
    } else {
      operationType = 'replace';
      fullDocument = record.fullDocument ?? null;
    }
    return {
      operationType,
      fullDocument,
      documentKey: { _id: record.documentId },
      updateDescription,
      // The replication protocol carries no document wall/cluster time; stamp at decode time.
      wallTime: new Date(),
      clusterTime: null
    };
  }

  async _handle(record) {
    if (!this.running || !this._matches(record)) return;
    try {
      const rawDoc = this._toRawChangeDoc(record);
      const envelope = mapEvent(rawDoc, this.captureConfig);
      const serialized = JSON.stringify(envelope);
      const maxBytes = Number(process.env.MONGO_CDC_MAX_MESSAGE_BYTES ?? 900000);
      let publishEnvelope = envelope;
      if (Buffer.byteLength(serialized) > maxBytes) {
        publishEnvelope = { ...envelope, data: { event_type: envelope.data.event_type, collection_name: envelope.data.collection_name, document_key: envelope.data.document_key, capture_config_id: envelope.data.capture_config_id, reason: 'oversized' } };
        await this.auditCallback('capture-oversized-event', this.captureConfig, rawDoc, publishEnvelope);
      }
      await this.kafkaPublisher.publish(this._topic(), this._partitionKey(), publishEnvelope, { 'ce-type': publishEnvelope.type, 'ce-source': publishEnvelope.source, 'ce-tenantid': publishEnvelope.tenantid, 'ce-workspaceid': publishEnvelope.workspaceid });
      // Persist then acknowledge ONLY after a durable publish, advancing the slot's confirmed LSN.
      await this.resumeTokenStore.upsert(this.captureConfig.id, record.lsn);
      await this.walClient.acknowledge(record.lsn);
      this.healthy = true;
    } catch (error) {
      // Halt before acking past the failed change: stop processing (so no later LSN is acked) and
      // mark errored. A supervisor restart resumes from the slot's last confirmed LSN (at-least-once).
      this.running = false;
      this.healthy = false;
      await this.auditCallback('capture-publish-error', this.captureConfig, null, { error: error.message }).catch(() => {});
      this.statusUpdateCallback('errored', error.message || 'publish-failed').catch(() => {});
      this.walClient.stop().catch(() => {});
    }
  }

  async start() {
    this.running = true;
    this.healthy = true;
    this.walClient.onChange = (record) => this._handle(record);
    this.walClient.on('error', (err) => {
      this.healthy = false;
      if (/max-reconnect/i.test(err?.message ?? '')) {
        this.statusUpdateCallback('errored', err.message).catch(() => {});
      }
    });
    await this.walClient.start();
  }

  async stop() {
    this.running = false;
    await this.walClient?.stop?.();
  }
}
