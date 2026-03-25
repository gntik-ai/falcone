import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MONGO_DATA_DEFAULT_BULK_LIMITS,
  MONGO_DATA_MANAGEMENT_CAPABILITIES,
  MongoDataApiError,
  buildMongoDataApiPlan,
  buildMongoDataScopedCredential,
  detectMongoRequestUniqueIndexConflicts,
  mongodbDataAdapterPort,
  normalizeMongoDataError,
  summarizeMongoDataApiCapabilityMatrix,
  validateMongoDocumentAgainstCollectionRules
} from '../../services/adapters/src/mongodb-data-api.mjs';

test('mongodb data adapter publishes CRUD, advanced data, and realtime bridge capabilities for document operations', () => {
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_query'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_insert'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_update'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_replace'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_delete'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_bulk_write'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_aggregate'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_import'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_export'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_transaction'));
  assert.ok(mongodbDataAdapterPort.capabilities.includes('mongo_data_change_stream'));
  assert.equal(summarizeMongoDataApiCapabilityMatrix().length, 12);
  assert.equal(MONGO_DATA_DEFAULT_BULK_LIMITS.maxPayloadBytes > 0, true);
});

test('mongodb data adapter validates nested document payloads against collection rules', () => {
  const validation = validateMongoDocumentAgainstCollectionRules(
    {
      tenantId: 'ten_alpha',
      profile: {
        name: 'Andrea',
        address: { city: 'Madrid', country: 'ES' }
      },
      tags: ['vip']
    },
    {
      $jsonSchema: {
        bsonType: 'object',
        required: ['tenantId', 'profile'],
        properties: {
          tenantId: { bsonType: 'string' },
          profile: {
            bsonType: 'object',
            required: ['name', 'address'],
            properties: {
              name: { bsonType: 'string', minLength: 2 },
              address: {
                bsonType: 'object',
                required: ['city', 'country'],
                properties: {
                  city: { bsonType: 'string' },
                  country: { bsonType: 'string', minLength: 2, maxLength: 2 }
                }
              }
            }
          },
          tags: {
            bsonType: 'array',
            items: { bsonType: 'string' }
          }
        }
      }
    }
  );

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.violations, []);
});

test('mongodb data adapter flags unique index conflicts inside bounded requests', () => {
  const conflicts = detectMongoRequestUniqueIndexConflicts({
    documents: [
      { tenantId: 'ten_alpha', email: 'a@example.com' },
      { tenantId: 'ten_alpha', email: 'a@example.com' },
      { tenantId: 'ten_alpha', email: 'b@example.com' }
    ],
    indexes: [{ name: 'uniq_email', unique: true, keys: { tenantId: 1, email: 1 } }]
  });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].indexName, 'uniq_email');
  assert.deepEqual(conflicts[0].keys, ['tenantId', 'email']);
});

test('mongodb data adapter builds a controlled bulk-write plan with tenant scoping, validation, and size checks', () => {
  const plan = buildMongoDataApiPlan({
    operation: 'bulk_write',
    workspaceId: 'ws_orders',
    databaseName: 'tenant_shared',
    collectionName: 'orders',
    tenantId: 'ten_alpha',
    actorId: 'svc_orders',
    actorType: 'service_account',
    originSurface: 'backend_service',
    requestId: 'req_bulk_001',
    correlationId: 'corr_bulk_001',
    payload: {
      limits: { maxOperations: 3, maxPayloadBytes: 2048, ordered: false },
      operations: [
        {
          kind: 'insertOne',
          document: {
            _id: 'ord_001',
            status: 'open',
            payload: { channel: 'web' }
          }
        },
        {
          kind: 'updateOne',
          filter: { status: 'open' },
          update: {
            $set: { 'payload.priority': 'high' }
          },
          existingDocument: {
            _id: 'ord_001',
            tenantId: 'ten_alpha',
            status: 'open',
            payload: { channel: 'web' }
          }
        },
        {
          kind: 'deleteMany',
          filter: { archived: true }
        }
      ]
    },
    collectionMetadata: {
      validationRules: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['tenantId', 'status'],
          properties: {
            tenantId: { bsonType: 'string' },
            status: { enum: ['open', 'closed'] },
            payload: { bsonType: 'object' }
          }
        }
      },
      indexes: [{ name: 'uniq_tenant_status', unique: true, keys: { tenantId: 1, _id: 1 } }]
    }
  });

  assert.equal(plan.bulk.operationCount, 3);
  assert.equal(plan.bulk.ordered, false);
  assert.equal(plan.bulk.operations[0].document.tenantId, 'ten_alpha');
  assert.equal(plan.bulk.operations[1].filter.$and[0].tenantId, 'ten_alpha');
  assert.equal(plan.bulk.payloadBytes > 0, true);
  assert.equal(plan.auditContext.actorType, 'service_account');
  assert.equal(plan.trace.workspaceId, 'ws_orders');

  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'bulk_write',
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        tenantId: 'ten_alpha',
        payload: {
          limits: { maxOperations: 2, maxPayloadBytes: 1024 },
          operations: [
            { kind: 'insertOne', document: { _id: 'ord_001', status: 'open' } },
            { kind: 'insertOne', document: { _id: 'ord_002', status: 'open' } },
            { kind: 'deleteMany', filter: { archived: true } }
          ]
        }
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_bulk_limit_exceeded'
  );
});

test('mongodb data adapter validates aggregation, transfer, transaction, and change-stream planners with plan policy limits', () => {
  const aggregationPlan = buildMongoDataApiPlan({
    operation: 'aggregate',
    workspaceId: 'ws_orders',
    databaseName: 'tenant_shared',
    collectionName: 'orders',
    tenantId: 'ten_alpha',
    requestId: 'req_agg_001',
    correlationId: 'corr_agg_001',
    actorId: 'svc_orders',
    actorType: 'service_account',
    originSurface: 'backend_service',
    planPolicy: {
      planId: 'growth',
      aggregation: {
        maxStages: 4,
        maxResultWindow: 200,
        maxTimeMs: 5000,
        maxLookupStages: 0,
        allowDiskUse: false
      },
      transaction: {
        maxOperations: 2,
        maxPayloadBytes: 4096,
        maxCommitTimeMs: 3000,
        readConcern: 'majority',
        writeConcern: 'majority',
        allowedReadConcerns: ['majority'],
        allowedWriteConcerns: ['majority']
      }
    },
    payload: {
      pipeline: [
        { $match: { status: 'open' } },
        { $group: { _id: '$status', total: { $sum: 1 } } },
        { $limit: 20 }
      ]
    }
  });
  const transactionPlan = buildMongoDataApiPlan({
    operation: 'transaction',
    workspaceId: 'ws_orders',
    databaseName: 'tenant_shared',
    tenantId: 'ten_alpha',
    topology: { clusterTopology: 'replica_set', supportsTransactions: true },
    planPolicy: {
      planId: 'growth',
      transaction: {
        maxOperations: 2,
        maxPayloadBytes: 4096,
        maxCommitTimeMs: 3000,
        readConcern: 'majority',
        writeConcern: 'majority',
        allowedReadConcerns: ['majority'],
        allowedWriteConcerns: ['majority']
      }
    },
    payload: {
      options: {
        maxOperations: 2,
        readConcern: 'majority',
        writeConcern: 'majority'
      },
      operations: [
        {
          kind: 'insert',
          collectionName: 'orders',
          document: { _id: 'ord_010', status: 'open' }
        }
      ]
    }
  });
  const changeStreamPlan = buildMongoDataApiPlan({
    operation: 'change_stream',
    workspaceId: 'ws_orders',
    databaseName: 'tenant_shared',
    collectionName: 'orders',
    tenantId: 'ten_alpha',
    topology: { clusterTopology: 'replica_set', supportsChangeStreams: true },
    bridge: { available: true, provider: 'event_gateway' },
    payload: {
      pipeline: [{ $project: { fullDocument: 1, operationType: 1 } }]
    }
  });

  assert.equal(aggregationPlan.aggregation.summary.stageNames.includes('$group'), true);
  assert.equal(aggregationPlan.planPolicy.planId, 'growth');
  assert.equal(aggregationPlan.planPolicy.aggregation.limits.maxStages, 4);
  assert.equal(transactionPlan.transaction.operationCount, 1);
  assert.equal(transactionPlan.planPolicy.transaction.limits.maxOperations, 2);
  assert.equal(changeStreamPlan.changeStream.bridge.status, 'ready');

  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'aggregate',
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        tenantId: 'ten_alpha',
        planPolicy: {
          planId: 'starter',
          aggregation: { enabled: false }
        },
        payload: {
          pipeline: [{ $match: { status: 'open' } }]
        }
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_plan_policy_violation'
  );

  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'aggregate',
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        tenantId: 'ten_alpha',
        planPolicy: {
          planId: 'growth',
          aggregation: { maxStages: 2 }
        },
        payload: {
          limits: { maxStages: 3 },
          pipeline: [{ $match: { status: 'open' } }]
        }
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_invalid_limit'
  );

  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'aggregate',
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        tenantId: 'ten_alpha',
        payload: {
          pipeline: [{ $merge: { into: 'archive' } }]
        }
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_pipeline_stage_blocked'
  );
});

test('mongodb data adapter normalizes provider failures into safe structured errors', () => {
  const duplicate = normalizeMongoDataError(
    {
      code: 11000,
      codeName: 'DuplicateKey',
      message: 'E11000 duplicate key error collection: tenant_shared.orders index: uniq_email dup key: { email: "dup@example.com" }'
    },
    {
      operation: 'insert',
      databaseName: 'tenant_shared',
      collectionName: 'orders',
      documentId: 'ord_001',
      workspaceId: 'ws_orders',
      tenantId: 'ten_alpha',
      actorId: 'svc_orders',
      actorType: 'service_account',
      originSurface: 'backend_service',
      correlationId: 'corr_err_001',
      requestId: 'req_err_001'
    }
  );
  const permission = normalizeMongoDataError(
    { message: 'not authorized on tenant_shared to execute command { find: "orders" }' },
    { operation: 'list', databaseName: 'tenant_shared', collectionName: 'orders' }
  );
  const notFound = normalizeMongoDataError(
    { message: 'document not found' },
    { operation: 'get', databaseName: 'tenant_shared', collectionName: 'orders', documentId: 'ord_missing' }
  );

  assert.equal(duplicate.code, 'mongo_data_conflict_unique_index');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.meta.indexName, 'uniq_email');
  assert.equal(duplicate.meta.audit.actorId, 'svc_orders');
  assert.equal(duplicate.meta.correctiveAction.includes('unique field value'), true);
  assert.equal(permission.code, 'mongo_data_permission_denied');
  assert.equal(permission.status, 403);
  assert.equal(permission.meta.reason, 'permission_denied');
  assert.equal(notFound.code, 'mongo_data_document_not_found');
  assert.equal(notFound.status, 404);
});

test('mongodb data adapter supports scoped credential planning and scope validation', () => {
  const credential = buildMongoDataScopedCredential({
    workspaceId: 'ws_orders',
    databaseName: 'tenant_shared',
    credentialId: 'cred_orders_reader',
    displayName: 'Orders reader',
    credentialType: 'token',
    ttlSeconds: 1800,
    actorId: 'usr_admin_01',
    actorType: 'user',
    tenantId: 'ten_alpha',
    originSurface: 'admin_console',
    correlationId: 'corr_cred_001',
    requestId: 'req_cred_001',
    scopes: [
      {
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        allowedOperations: ['list', 'get', 'export']
      }
    ]
  });

  assert.equal(credential.capability, MONGO_DATA_MANAGEMENT_CAPABILITIES.scoped_credential);
  assert.equal(credential.trace.requestId, 'req_cred_001');
  assert.equal(credential.auditSummary.operationClass, 'credential');

  assert.throws(
    () =>
      buildMongoDataScopedCredential({
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        scopes: [
          {
            databaseName: 'other_db',
            collectionName: 'orders',
            allowedOperations: ['list']
          }
        ]
      }),
    (error) => error instanceof MongoDataApiError && error.code === 'mongo_data_scope_violation'
  );
});

test('mongodb data adapter rejects large or conflicting bulk payloads deterministically', () => {
  assert.throws(
    () =>
      buildMongoDataApiPlan({
        operation: 'bulk_write',
        workspaceId: 'ws_orders',
        databaseName: 'tenant_shared',
        collectionName: 'orders',
        tenantId: 'ten_alpha',
        payload: {
          limits: { maxOperations: 4, maxPayloadBytes: 280 },
          operations: [
            { kind: 'insertOne', document: { _id: 'ord_001', email: 'dup@example.com', notes: 'x'.repeat(140) } },
            { kind: 'insertOne', document: { _id: 'ord_002', email: 'dup@example.com', notes: 'x'.repeat(140) } }
          ]
        },
        collectionMetadata: {
          indexes: [{ name: 'uniq_email', unique: true, keys: { tenantId: 1, email: 1 } }]
        }
      }),
    (error) => error instanceof MongoDataApiError && ['mongo_data_bulk_payload_too_large', 'mongo_data_conflict'].includes(error.code)
  );
});
