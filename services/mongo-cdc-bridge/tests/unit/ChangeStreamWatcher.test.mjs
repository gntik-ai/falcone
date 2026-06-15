import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeStreamWatcher, diffImages } from '../../src/ChangeStreamWatcher.mjs';

const captureConfig = {
  id: 'cfg-1',
  tenant_id: 'ten_a',
  workspace_id: 'ws_a',
  data_source_ref: 'ds-1',
  database_name: 'db1',
  collection_name: 'notes',
  capture_mode: 'delta'
};

// Minimal fake WalReplicationClient: capture the onChange handler + ack/stop calls.
function fakeWalClient() {
  return {
    onChange: null,
    started: false,
    stopped: false,
    acks: [],
    _errorHandlers: [],
    on(event, handler) { if (event === 'error') this._errorHandlers.push(handler); },
    emitError(err) { for (const h of this._errorHandlers) h(err); },
    async start() { this.started = true; },
    async stop() { this.stopped = true; },
    async acknowledge(lsn) { this.acks.push(lsn); }
  };
}

function harness(overrides = {}) {
  const published = [];
  const upserts = [];
  const statuses = [];
  const walClient = fakeWalClient();
  const kafkaPublisher = {
    resolveTopic: () => 'ten_a.ws_a.mongo-changes',
    publish: overrides.publish ?? (async (...args) => { published.push(args); })
  };
  const resumeTokenStore = { upsert: async (id, lsn) => { upserts.push([id, lsn]); } };
  const watcher = new ChangeStreamWatcher({
    captureConfig,
    walClient,
    kafkaPublisher,
    resumeTokenStore,
    statusUpdateCallback: async (status, err) => { statuses.push([status, err]); }
  });
  return { watcher, walClient, published, upserts, statuses };
}

const rec = (over) => ({
  lsn: '0/1',
  operationType: 'insert',
  database: 'db1',
  collection: 'notes',
  tenantId: 'ten_a',
  documentId: 'd1',
  fullDocument: { _id: 'd1', tenantId: 'ten_a', body: 'a' },
  fullDocumentBeforeChange: null,
  ...over
});

test('publishes an insert, then persists + acknowledges the LSN', async () => {
  const { watcher, walClient, published, upserts } = harness();
  await watcher.start();
  await walClient.onChange(rec({ lsn: '0/AA' }));

  assert.equal(published.length, 1);
  const envelope = published[0][2];
  assert.equal(envelope.data.event_type, 'insert');
  assert.deepEqual(envelope.data.full_document, { _id: 'd1', tenantId: 'ten_a', body: 'a' });
  assert.deepEqual(envelope.data.document_key, { _id: 'd1' });
  // Persist BEFORE acknowledge, both with the change's LSN.
  assert.deepEqual(upserts, [['cfg-1', '0/AA']]);
  assert.deepEqual(walClient.acks, ['0/AA']);
});

test('filters out cross-tenant and cross-collection changes (no publish, no ack)', async () => {
  const { watcher, walClient, published, upserts } = harness();
  await watcher.start();
  await walClient.onChange(rec({ tenantId: 'ten_b', documentId: 'x', fullDocument: { _id: 'x', tenantId: 'ten_b' } }));
  await walClient.onChange(rec({ collection: 'other', documentId: 'y' }));
  assert.equal(published.length, 0, 'no cross-tenant / cross-collection publish');
  assert.equal(upserts.length, 0);
  assert.equal(walClient.acks.length, 0);
});

test('delta-mode UPDATE synthesises updateDescription from the pre/post images', async () => {
  const { watcher, walClient, published } = harness();
  await watcher.start();
  await walClient.onChange(rec({
    operationType: 'update',
    fullDocumentBeforeChange: { _id: 'd1', tenantId: 'ten_a', body: 'a', stale: 1 },
    fullDocument: { _id: 'd1', tenantId: 'ten_a', body: 'b' }
  }));
  const envelope = published[0][2];
  assert.equal(envelope.data.event_type, 'update');
  assert.equal(envelope.data.full_document, null, 'delta update carries no full document');
  assert.deepEqual(envelope.data.update_description, { updatedFields: { body: 'b' }, removedFields: ['stale'] });
});

test('DELETE publishes with the document key and no full document', async () => {
  const { watcher, walClient, published } = harness();
  await watcher.start();
  await walClient.onChange(rec({
    operationType: 'delete',
    fullDocument: null,
    fullDocumentBeforeChange: { _id: 'd1', tenantId: 'ten_a', body: 'b' }
  }));
  const envelope = published[0][2];
  assert.equal(envelope.data.event_type, 'delete');
  assert.equal(envelope.data.full_document, null);
  assert.deepEqual(envelope.data.document_key, { _id: 'd1' });
});

test('full-document mode maps a WAL update to replace with the full document', async () => {
  const { watcher, walClient, published } = harness();
  watcher.captureConfig = { ...captureConfig, capture_mode: 'full-document' };
  await watcher.start();
  await walClient.onChange(rec({ operationType: 'update', fullDocument: { _id: 'd1', tenantId: 'ten_a', body: 'b' }, fullDocumentBeforeChange: { _id: 'd1', body: 'a' } }));
  const envelope = published[0][2];
  assert.equal(envelope.data.event_type, 'replace');
  assert.deepEqual(envelope.data.full_document, { _id: 'd1', tenantId: 'ten_a', body: 'b' });
});

test('on publish failure: halts, does NOT acknowledge, marks errored (no WAL gap)', async () => {
  const { watcher, walClient, upserts, statuses } = harness({ publish: async () => { throw new Error('kafka-down'); } });
  await watcher.start();
  await walClient.onChange(rec({ lsn: '0/BB' }));

  assert.equal(walClient.acks.length, 0, 'failed change is never acknowledged');
  assert.equal(watcher.isHealthy(), false);
  assert.equal(watcher.running, false, 'processing halted');
  assert.ok(walClient.stopped, 'replication stopped to avoid acking past the failure');
  assert.ok(statuses.some(([s]) => s === 'errored'));

  // A subsequent change must NOT be processed (no ack advancing past the failed LSN).
  await walClient.onChange(rec({ lsn: '0/CC' }));
  assert.equal(walClient.acks.length, 0);
});

test('diffImages reports updated and removed top-level fields', () => {
  assert.deepEqual(
    diffImages({ a: 1, b: 2, gone: 9 }, { a: 1, b: 3, c: 4 }),
    { updatedFields: { b: 3, c: 4 }, removedFields: ['gone'] }
  );
});
