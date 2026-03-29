import {
  assignKeycloakRole,
  revokeKeycloakRole,
  revertMembershipRecord,
  updateMembershipRecord
} from '../workflows/wf-con-001.mjs';
import {
  configureApisixRoutes,
  createKafkaNamespace,
  createKeycloakRealm,
  createPostgresqlBoundary,
  deleteKafkaNamespace,
  deleteKeycloakRealm,
  deletePostgresqlBoundary,
  removeApisixRoutes
} from '../workflows/wf-con-002.mjs';
import {
  createKeycloakClient,
  createPostgresqlWorkspace,
  deleteKeycloakClient,
  deletePostgresqlWorkspace,
  releaseS3Storage,
  reserveS3Storage
} from '../workflows/wf-con-003.mjs';
import {
  createKeycloakCredential,
  deleteCredentialMetadata,
  recordCredentialMetadata,
  removeApisixConsumer,
  revertKeycloakCredential,
  syncApisixConsumer
} from '../workflows/wf-con-004.mjs';
import { createServiceAccount, deleteServiceAccount } from '../workflows/wf-con-006.mjs';

export const sagaDefinitions = new Map([
  ['WF-CON-001', {
    workflowId: 'WF-CON-001',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'assign-keycloak-role', forward: assignKeycloakRole, compensate: revokeKeycloakRole },
      { ordinal: 2, key: 'update-membership-record', forward: updateMembershipRecord, compensate: revertMembershipRecord }
    ]
  }],
  ['WF-CON-002', {
    workflowId: 'WF-CON-002',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-keycloak-realm', forward: createKeycloakRealm, compensate: deleteKeycloakRealm },
      { ordinal: 2, key: 'create-postgresql-boundary', forward: createPostgresqlBoundary, compensate: deletePostgresqlBoundary },
      { ordinal: 3, key: 'create-kafka-namespace', forward: createKafkaNamespace, compensate: deleteKafkaNamespace },
      { ordinal: 4, key: 'configure-apisix-routes', forward: configureApisixRoutes, compensate: removeApisixRoutes }
    ]
  }],
  ['WF-CON-003', {
    workflowId: 'WF-CON-003',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-keycloak-client', forward: createKeycloakClient, compensate: deleteKeycloakClient },
      { ordinal: 2, key: 'create-postgresql-workspace', forward: createPostgresqlWorkspace, compensate: deletePostgresqlWorkspace },
      { ordinal: 3, key: 'reserve-s3-storage', forward: reserveS3Storage, compensate: releaseS3Storage }
    ]
  }],
  ['WF-CON-004', {
    workflowId: 'WF-CON-004',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-keycloak-credential', forward: createKeycloakCredential, compensate: revertKeycloakCredential },
      { ordinal: 2, key: 'sync-apisix-consumer', forward: syncApisixConsumer, compensate: removeApisixConsumer },
      { ordinal: 3, key: 'record-credential-metadata', forward: recordCredentialMetadata, compensate: deleteCredentialMetadata }
    ]
  }],
  ['WF-CON-005', {
    workflowId: 'WF-CON-005',
    provisional: true,
    recoveryPolicy: 'compensate',
    steps: [] // WF-CON-005 is provisional; add steps when catalog entry is finalized
  }],
  ['WF-CON-006', {
    workflowId: 'WF-CON-006',
    provisional: false,
    recoveryPolicy: 'compensate',
    steps: [
      { ordinal: 1, key: 'create-service-account', forward: createServiceAccount, compensate: deleteServiceAccount }
    ] // WF-CON-006 steps to be completed when catalog entry is finalized per specs/067
  }]
]);
