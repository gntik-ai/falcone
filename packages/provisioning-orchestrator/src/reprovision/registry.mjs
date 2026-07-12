/**
 * Applier registry — maps domain keys to applier functions based on feature flags.
 * @module reprovision/registry
 */

import { apply as applyIam } from '../appliers/iam-applier.mjs';
import { apply as applyPostgres } from '../appliers/postgres-applier.mjs';
import { apply as applyDocumentdbIdentity } from '../appliers/documentdb-identity-applier.mjs';
import { apply as applyMongo } from '../appliers/mongo-applier.mjs';
import { apply as applyKafka } from '../appliers/kafka-applier.mjs';
import { apply as applyFunctions } from '../appliers/functions-applier.mjs';
import { apply as applyStorage } from '../appliers/storage-applier.mjs';

// Canonical execution order of appliers. `documentdb_identity` runs AFTER
// `postgres_metadata` (relational schema first; Design D5 fail-closed) and is processed
// only when the tenant artifact carries that domain AND the applier is registered (see
// CONFIG_IMPORT_DOCUMENTDB_IDENTITY_ENABLED below) — the reprovision loop skips domains
// absent from the artifact, so this addition is inert for tenants that don't use it.
export const APPLIER_ORDER = ['iam', 'postgres_metadata', 'documentdb_identity', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/**
 * Build the applier registry based on deployment profile and feature flags.
 *
 * @param {string} [deploymentProfile]
 * @returns {Map<string, (tenantId: string, domainData: Object, options: Object) => Promise<import('./types.mjs').DomainResult>>}
 */
export function getApplierRegistry(deploymentProfile = 'standard') {
  const owEnabled = process.env.CONFIG_IMPORT_OW_ENABLED === 'true';
  const mongoEnabled = process.env.CONFIG_IMPORT_MONGO_ENABLED === 'true';
  // FerretDB migration (#458): per-tenant DocumentDB credential provisioning over the
  // MongoDB wire protocol. Default OFF until the document-store cutover, mirroring the
  // chart's documentdb.enabled / ferretdb.enabled defaults.
  const documentdbIdentityEnabled = process.env.CONFIG_IMPORT_DOCUMENTDB_IDENTITY_ENABLED === 'true';

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

  if (documentdbIdentityEnabled) {
    registry.set('documentdb_identity', applyDocumentdbIdentity);
  }

  if (owEnabled) {
    registry.set('functions', applyFunctions);
  }

  return registry;
}
