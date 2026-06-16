/**
 * Black-box tests for the FerretDB/DocumentDB CDC path over Postgres logical replication
 * (add-ferretdb-realtime-cdc-remediation #460). FerretDB v2 has no MongoDB change streams, so the
 * CDC bridge consumes a pgoutput WAL slot. These drive the PUBLIC API of the WAL CDC components
 * (ChangeStreamWatcher fed by a WalReplicationClient-shaped source, the real KafkaChangePublisher,
 * the pure WalBsonDecoder) with fakes — no internal knowledge, no live stack.
 *
 * bbx-cdc-wal-01: a WAL insert is mapped + published to the tenant's Kafka topic (CDC capture works)
 * bbx-cdc-wal-02: a WAL update surfaces as a delta updateDescription; delete carries the document key
 * bbx-cdc-wal-03: cross-tenant WAL records are NEVER published (consumer-side tenantId filter)
 * bbx-cdc-wal-04: the Kafka topic namespacing contract is unchanged after the WAL migration
 * bbx-cdc-wal-05: WalBsonDecoder maps insert/update/delete tuples (incl. delete pre-image)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ChangeStreamWatcher } from '../../services/mongo-cdc-bridge/src/ChangeStreamWatcher.mjs';
import { KafkaChangePublisher as MongoKafkaChangePublisher } from '../../services/mongo-cdc-bridge/src/KafkaChangePublisher.mjs';
import { decodeWalMessage } from '../../services/mongo-cdc-bridge/src/WalBsonDecoder.mjs';

const captureConfig = {
  id: 'cfg-wal-1',
  tenant_id: 'tenant-a',
  workspace_id: 'ws-1',
  data_source_ref: 'ferretdb-main',
  database_name: 'app',
  collection_name: 'orders',
  capture_mode: 'delta',
};

// Minimal WalReplicationClient stand-in: captures the watcher's onChange handler + ack/stop calls.
function fakeWalClient() {
  return {
    onChange: null,
    stopped: false,
    acks: [],
    on() {},
    async start() {},
    async stop() { this.stopped = true; },
    async acknowledge(lsn) { this.acks.push(lsn); },
  };
}

// Real KafkaChangePublisher wired to a fake producer so we can assert the resolved per-tenant topic.
function harness() {
  const sent = [];
  const kafka = { producerObj: { connect: async () => {}, send: async (p) => sent.push(p), disconnect: async () => {} } };
  const prev = process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX;
  delete process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX;
  const restore = () => { if (prev !== undefined) process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX = prev; };
  return { sent, kafka, restore };
}

const walRecord = (over) => ({
  lsn: '0/1',
  operationType: 'insert',
  database: 'app',
  collection: 'orders',
  tenantId: 'tenant-a',
  documentId: 'doc-1',
  fullDocument: { _id: 'doc-1', tenantId: 'tenant-a', total: 10 },
  fullDocumentBeforeChange: null,
  ...over,
});

async function startWatcher({ sent, kafka }) {
  const publisher = new MongoKafkaChangePublisher({ kafka });
  await publisher.connect();
  const walClient = fakeWalClient();
  const watcher = new ChangeStreamWatcher({
    captureConfig,
    walClient,
    kafkaPublisher: publisher,
    resumeTokenStore: { upsert: async () => {} },
    statusUpdateCallback: async () => {},
  });
  await watcher.start();
  return { watcher, walClient };
}

test('bbx-cdc-wal-01: a WAL insert is mapped and published to the tenant Kafka topic', async () => {
  const { sent, kafka, restore } = harness();
  try {
    const { walClient } = await startWatcher({ sent, kafka });
    await walClient.onChange(walRecord({ lsn: '0/AA' }));

    assert.equal(sent.length, 1, 'exactly one Kafka message published for the insert');
    assert.equal(sent[0].topic, 'tenant-a.ws-1.mongo-changes', 'routed to the per-tenant topic');
    const env = JSON.parse(sent[0].messages[0].value);
    assert.equal(env.data.event_type, 'insert');
    assert.deepEqual(env.data.full_document, { _id: 'doc-1', tenantId: 'tenant-a', total: 10 });
    assert.deepEqual(env.data.document_key, { _id: 'doc-1' });
    assert.equal(env.tenantid, 'tenant-a');
    assert.deepEqual(walClient.acks, ['0/AA'], 'LSN acknowledged after publish');
  } finally { restore(); }
});

test('bbx-cdc-wal-02: WAL update → delta updateDescription; delete → document key, no full document', async () => {
  const { sent, kafka, restore } = harness();
  try {
    const { walClient } = await startWatcher({ sent, kafka });
    await walClient.onChange(walRecord({
      operationType: 'update',
      fullDocumentBeforeChange: { _id: 'doc-1', tenantId: 'tenant-a', total: 10 },
      fullDocument: { _id: 'doc-1', tenantId: 'tenant-a', total: 20 },
    }));
    await walClient.onChange(walRecord({
      operationType: 'delete', fullDocument: null,
      fullDocumentBeforeChange: { _id: 'doc-1', tenantId: 'tenant-a', total: 20 },
    }));

    const upd = JSON.parse(sent[0].messages[0].value);
    assert.equal(upd.data.event_type, 'update');
    assert.deepEqual(upd.data.update_description, { updatedFields: { total: 20 }, removedFields: [] });
    assert.equal(upd.data.full_document, null, 'delta update carries no full document');

    const del = JSON.parse(sent[1].messages[0].value);
    assert.equal(del.data.event_type, 'delete');
    assert.deepEqual(del.data.document_key, { _id: 'doc-1' });
    assert.equal(del.data.full_document, null);
  } finally { restore(); }
});

test('bbx-cdc-wal-03: cross-tenant WAL records are NEVER published (consumer-side tenantId filter)', async () => {
  const { sent, kafka, restore } = harness();
  try {
    const { walClient } = await startWatcher({ sent, kafka });
    // Tenant B document on the shared slot — the watcher is scoped to tenant A.
    await walClient.onChange(walRecord({ lsn: '0/B1', tenantId: 'tenant-b', documentId: 'doc-b', fullDocument: { _id: 'doc-b', tenantId: 'tenant-b' } }));
    // A different collection under tenant A — also out of scope for this capture config.
    await walClient.onChange(walRecord({ lsn: '0/B2', collection: 'invoices', documentId: 'doc-c' }));

    assert.equal(sent.length, 0, 'no cross-tenant / cross-collection Kafka message published');
    // Out-of-scope records are still acknowledged so the shared schema-wide slot's cursor advances.
    assert.deepEqual(walClient.acks, ['0/B1', '0/B2']);
  } finally { restore(); }
});

test('bbx-cdc-wal-04: Kafka topic namespacing contract is unchanged after the WAL migration', async () => {
  const { kafka, restore } = harness();
  try {
    const publisher = new MongoKafkaChangePublisher({ kafka });
    // Contract: {prefix?.}{tenantId}.{workspaceId}.mongo-changes — never replaceable tenant/workspace.
    assert.equal(publisher.resolveTopic({ tenant_id: 'tenant-a', workspace_id: 'ws-1' }), 'tenant-a.ws-1.mongo-changes');
    process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX = 'prod';
    assert.equal(publisher.resolveTopic({ tenant_id: 'tenant-b', workspace_id: 'ws-9' }), 'prod.tenant-b.ws-9.mongo-changes');
  } finally { restore(); }
});

test('bbx-cdc-wal-05: WalBsonDecoder maps insert/update/delete tuples incl. the delete pre-image', () => {
  const rel = (name) => ({ schema: 'documentdb_data', name });
  // pgoutput renders the `document` bson column as BSONHEX<hex>; the engine produces these exact
  // bytes for the documents below (verified against postgres-documentdb 17-0.107.0-ferretdb-2.7.0).
  const HEX_N5 = 'BSONHEX29000000025f696400030000006431000274656e616e7449640003000000743100106e000500000000'; // {_id:'d1',tenantId:'t1',n:5}
  const HEX_N9 = 'BSONHEX29000000025f696400030000006431000274656e616e7449640003000000743100106e000900000000'; // {_id:'d1',tenantId:'t1',n:9}

  const ins = decodeWalMessage({ tag: 'insert', relation: rel('documents_2'), new: { document: HEX_N5 } });
  assert.deepEqual(ins, { walOp: 'insert', collectionId: 2, documentId: 'd1', tenantId: 't1', fullDocument: { _id: 'd1', tenantId: 't1', n: 5 }, fullDocumentBeforeChange: null });

  const upd = decodeWalMessage({ tag: 'update', relation: rel('documents_2'), old: { document: HEX_N5 }, new: { document: HEX_N9 } });
  assert.equal(upd.walOp, 'update');
  assert.equal(upd.fullDocument.n, 9);
  assert.equal(upd.fullDocumentBeforeChange.n, 5, 'update carries the pre-image (REPLICA IDENTITY FULL)');

  const del = decodeWalMessage({ tag: 'delete', relation: rel('documents_2'), old: { document: HEX_N9 } });
  assert.equal(del.walOp, 'delete');
  assert.equal(del.fullDocument, null);
  assert.equal(del.tenantId, 't1', 'delete tenantId read from the pre-image');
  assert.equal(del.fullDocumentBeforeChange.n, 9);

  // Non-documents relations and non-DML are ignored (retry_N / cron noise never decodes to a change).
  assert.equal(decodeWalMessage({ tag: 'insert', relation: rel('retry_2'), new: {} }), null);
  assert.equal(decodeWalMessage({ tag: 'begin' }), null);
  assert.equal(decodeWalMessage({ tag: 'insert', relation: { schema: 'cron', name: 'job_run_details' }, new: {} }), null);
});
