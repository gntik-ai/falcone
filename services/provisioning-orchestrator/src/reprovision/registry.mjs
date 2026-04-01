/**
 * Applier registry — maps domain keys to applier functions based on feature flags.
 * @module reprovision/registry
 */

import { apply as applyIam } from '../appliers/iam-applier.mjs';
import { apply as applyPostgres } from '../appliers/postgres-applier.mjs';
import { apply as applyMongo } from '../appliers/mongo-applier.mjs';
import { apply as applyKafka } from '../appliers/kafka-applier.mjs';
import { apply as applyFunctions } from '../appliers/functions-applier.mjs';
import { apply as applyStorage } from '../appliers/storage-applier.mjs';

/** Canonical execution order of appliers. */
export const APPLIER_ORDER = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/**
 * Build the applier registry based on deployment profile and feature flags.
 *
 * @param {string} [deploymentProfile]
 * @returns {Map<string, (tenantId: string, domainData: Object, options: Object) => Promise<import('./types.mjs').DomainResult>>}
 */
export function getApplierRegistry(deploymentProfile = 'standard') {
  const owEnabled = process.env.CONFIG_IMPORT_OW_ENABLED === 'true';
  const mongoEnabled = process.env.CONFIG_IMPORT_MONGO_ENABLED === 'true';

  /** @type {Map<string, Function>} */
  const registry = new Map();

  // Always-available appliers
  registry.set('iam', applyIam);
  registry.set('postgres_metadata', applyPostgres);
  registry.set('kafka', applyKafka);
  registry.set('storage', applyStorage);

  // Feature-gated appliers
  if (mongoEnabled) {
    registry.set('mongo_metadata', applyMongo);
  }

  if (owEnabled) {
    registry.set('functions', applyFunctions);
  }

  return registry;
}
