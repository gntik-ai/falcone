/**
 * Collector registry — maps domain keys to collector functions based on deployment profile and feature flags.
 * @module collectors/registry
 */

import { collect as collectIam } from './iam-collector.mjs';
import { collect as collectPostgres } from './postgres-collector.mjs';
import { collect as collectMongo } from './mongo-collector.mjs';
import { collect as collectKafka } from './kafka-collector.mjs';
import { collect as collectFunctions } from './functions-collector.mjs';
import { collect as collectS3 } from './s3-collector.mjs';

/** All domains the platform knows about, regardless of availability. */
export const KNOWN_DOMAINS = /** @type {const} */ ([
  'iam',
  'postgres_metadata',
  'mongo_metadata',
  'kafka',
  'functions',
  'storage',
]);

/** Human descriptions per domain. */
export const DOMAIN_DESCRIPTIONS = {
  iam: 'IAM configuration (Keycloak)',
  postgres_metadata: 'PostgreSQL schema and metadata',
  mongo_metadata: 'MongoDB collections and metadata',
  kafka: 'Kafka topics, ACLs and consumer groups',
  functions: 'OpenWhisk serverless functions',
  storage: 'S3-compatible bucket configuration',
};

/**
 * Build a `not_available` stub result.
 * @param {string} domainKey
 * @param {string} reason
 * @returns {() => Promise<import('./types.mjs').CollectorResult>}
 */
function notAvailableStub(domainKey, reason) {
  return async () => ({
    domain_key: domainKey,
    status: 'not_available',
    exported_at: new Date().toISOString(),
    reason,
    data: null,
  });
}

/**
 * Returns a Map<domainKey, collectorFn> for the given deployment profile.
 * Feature flags `CONFIG_EXPORT_OW_ENABLED` and `CONFIG_EXPORT_MONGO_ENABLED`
 * control optional collectors.
 *
 * @param {string} deploymentProfile
 * @returns {Map<string, (tenantId: string, options?: object) => Promise<import('./types.mjs').CollectorResult>>}
 */
export function getRegistry(deploymentProfile = 'standard') {
  const owEnabled = process.env.CONFIG_EXPORT_OW_ENABLED === 'true';
  const mongoEnabled = process.env.CONFIG_EXPORT_MONGO_ENABLED === 'true';

  /** @type {Map<string, (tenantId: string, options?: object) => Promise<import('./types.mjs').CollectorResult>>} */
  const registry = new Map();

  // Always-available collectors
  registry.set('iam', collectIam);
  registry.set('postgres_metadata', collectPostgres);
  registry.set('kafka', collectKafka);
  registry.set('storage', collectS3);

  // Feature-gated collectors
  if (mongoEnabled) {
    registry.set('mongo_metadata', collectMongo);
  } else {
    registry.set('mongo_metadata', notAvailableStub('mongo_metadata', `MongoDB collector disabled (CONFIG_EXPORT_MONGO_ENABLED=false)`));
  }

  if (owEnabled) {
    registry.set('functions', collectFunctions);
  } else {
    registry.set('functions', notAvailableStub('functions', `OpenWhisk collector disabled in profile '${deploymentProfile}' (CONFIG_EXPORT_OW_ENABLED=false)`));
  }

  return registry;
}
