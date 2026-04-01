/**
 * Public API for the config export schema registry.
 * @module schemas
 */

export {
  getCurrentVersion,
  getMinMigratable,
  getSupportedVersions,
  getSchemaFor,
  getChecksum,
  isSameMajor,
  isKnownVersion,
  isFutureVersion,
  buildMigrationChain,
  getSchemaRegistry,
} from './schema-registry.mjs';
