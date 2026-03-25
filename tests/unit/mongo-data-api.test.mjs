import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMongoDataApiRoute,
  listMongoDataApiRoutes,
  mongoDataApiFamily,
  mongoDataApiRoutes,
  mongoDataRequestContract,
  mongoDataResultContract,
  summarizeMongoDataApiSurface
} from '../../apps/control-plane/src/mongo-data-api.mjs';
import {
  MONGO_DATA_AGGREGATION_STAGES,
  MONGO_DATA_API_CAPABILITIES,
  MONGO_DATA_API_OPERATIONS,
  MONGO_DATA_BULK_ACTIONS,
  MONGO_DATA_CHANGE_STREAM_STAGES,
  MONGO_DATA_EXPORT_FORMATS,
  MONGO_DATA_FILTER_OPERATORS,
  MONGO_DATA_IMPORT_MODES,
  MONGO_DATA_MANAGEMENT_CAPABILITIES,
  MONGO_DATA_SCOPED_CREDENTIAL_TYPES,
  MONGO_DATA_SORT_DIRECTIONS,
  MONGO_DATA_SUPPORTED_TOPOLOGIES,
  MONGO_DATA_TRANSACTION_ACTIONS,
  MONGO_DATA_UPDATE_OPERATORS,
  buildMongoDataAuditSummary,
  buildMongoDataScopedCredential,
  summarizeMongoDataApiCapabilityMatrix
} from '../../services/adapters/src/mongodb-data-api.mjs';

test('mongo data API public surface publishes CRUD, advanced operations, and scoped credential governance routes', () => {
  const summary = summarizeMongoDataApiSurface({
    topology: { clusterTopology: 'replica_set', supportsTransactions: true, supportsChangeStreams: true },
    bridge: { available: true, provider: 'event_gateway' }
  });

  assert.equal(mongoDataApiFamily?.id, 'mongo');
  assert.equal(mongoDataRequestContract?.owner, 'control_api');
  assert.equal(mongoDataResultContract?.owner, 'provisioning_orchestrator');
  assert.equal(mongoDataApiRoutes.length, 16);
  assert.equal(listMongoDataApiRoutes({ method: 'GET' }).length, 4);
  assert.equal(getMongoDataApiRoute('bulkWriteMongoDataDocuments')?.resourceType, 'mongo_data_bulk');
  assert.equal(getMongoDataApiRoute('aggregateMongoDataDocuments')?.resourceType, 'mongo_data_aggregation');
  assert.equal(getMongoDataApiRoute('executeMongoDataTransaction')?.resourceType, 'mongo_data_transaction');
  assert.equal(getMongoDataApiRoute('createMongoDataCredential')?.resourceType, 'mongo_data_credential');
  assert.equal(getMongoDataApiRoute('revokeMongoDataCredential')?.resourceType, 'mongo_data_credential');
  assert.equal(summary.routeCount, 16);
  assert.equal(summary.operations.find((entry) => entry.operation === 'bulk_write')?.routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'aggregate')?.routeCount, 1);
  assert.equal(summary.operations.find((entry) => entry.operation === 'scoped_credential')?.routeCount, 4);
  assert.deepEqual(summary.credentialTypes, ['api_key', 'token']);
});

test('mongo data API surface helpers expose supported operators and compatibility metadata', () => {
  assert.deepEqual(MONGO_DATA_API_OPERATIONS, [
    'list',
    'get',
    'insert',
    'update',
    'replace',
    'delete',
    'bulk_write',
    'aggregate',
    'import',
    'export',
    'transaction',
    'change_stream'
  ]);
  assert.equal(MONGO_DATA_API_CAPABILITIES.aggregate, 'mongo_data_aggregate');
  assert.equal(MONGO_DATA_MANAGEMENT_CAPABILITIES.scoped_credential, 'mongo_data_scoped_credential');
  assert.deepEqual(MONGO_DATA_FILTER_OPERATORS, ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$regex', '$elemMatch', '$and', '$or']);
  assert.deepEqual(MONGO_DATA_UPDATE_OPERATORS, ['$set', '$unset', '$inc', '$push', '$pull']);
  assert.deepEqual(MONGO_DATA_BULK_ACTIONS, ['insertOne', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany']);
  assert.deepEqual(MONGO_DATA_SORT_DIRECTIONS, ['asc', 'desc']);
  assert.deepEqual(MONGO_DATA_IMPORT_MODES, ['insert', 'replace', 'upsert']);
  assert.deepEqual(MONGO_DATA_EXPORT_FORMATS, ['json']);
  assert.deepEqual(MONGO_DATA_TRANSACTION_ACTIONS, ['insert', 'update', 'replace', 'delete']);
  assert.deepEqual(MONGO_DATA_SCOPED_CREDENTIAL_TYPES, ['api_key', 'token']);
  assert.equal(MONGO_DATA_AGGREGATION_STAGES.includes('$lookup'), true);
  assert.equal(MONGO_DATA_CHANGE_STREAM_STAGES.includes('$project'), true);
  assert.deepEqual(MONGO_DATA_SUPPORTED_TOPOLOGIES, ['replica_set', 'sharded_cluster']);

  const compatibility = summarizeMongoDataApiCapabilityMatrix({
    topology: { clusterTopology: 'replica_set', supportsTransactions: true, supportsChangeStreams: true },
    bridge: { available: true, provider: 'event_gateway' }
  });
  assert.equal(compatibility.length, 12);
  assert.equal(compatibility.find((entry) => entry.operation === 'transaction')?.compatibility.supported, true);
  assert.equal(compatibility.find((entry) => entry.operation === 'change_stream')?.compatibility.bridge.status, 'ready');
});

test('mongo data API governance helpers support scoped credentials and audit summaries', () => {
  const scopedCredential = buildMongoDataScopedCredential({
    workspaceId: 'wrk_01alphaprod',
    databaseName: 'tenant_alpha_main',
    credentialId: 'cred_orders_reader',
    credentialType: 'api_key',
    displayName: 'Orders reader',
    ttlSeconds: 7200,
    actorId: 'usr_admin_01',
    actorType: 'user',
    tenantId: 'ten_alpha',
    originSurface: 'admin_console',
    correlationId: 'corr_mongo_credential_001',
    requestId: 'req_mongo_credential_001',
    scopes: [
      {
        databaseName: 'tenant_alpha_main',
        collectionName: 'customer_orders',
        allowedOperations: ['list', 'get', 'aggregate', 'export']
      }
    ]
  });
  const auditSummary = buildMongoDataAuditSummary({ operation: 'aggregate' });

  assert.equal(scopedCredential.capability, 'mongo_data_scoped_credential');
  assert.equal(scopedCredential.scopes[0].collectionName, 'customer_orders');
  assert.deepEqual(scopedCredential.scopes[0].allowedOperations, ['list', 'get', 'aggregate', 'export']);
  assert.equal(scopedCredential.trace.actorType, 'user');
  assert.equal(scopedCredential.trace.workspaceId, 'wrk_01alphaprod');
  assert.equal(scopedCredential.auditSummary.operationClass, 'credential');
  assert.equal(auditSummary.operationClass, 'aggregation');
  assert.equal(auditSummary.capturesTenantContext, true);
});
