/**
 * Identifier map generation, validation, and application.
 * @module reprovision/identifier-map
 */

import { REDACTED_MARKER } from './types.mjs';

/**
 * Convention-based derivation helpers for identifier translation.
 * These follow the platform's naming conventions per subsystem.
 */
function deriveIamRealm(tenantId) {
  return tenantId; // realm name matches tenant id
}

function derivePgSchema(tenantId) {
  return tenantId.replace(/-/g, '_');
}

function deriveMongoDatabase(tenantId) {
  return tenantId.replace(/-/g, '_');
}

function deriveKafkaPrefix(tenantId) {
  return `${tenantId}.`;
}

function deriveFunctionsNamespace(tenantId) {
  return tenantId;
}

function deriveStorageBucketPrefix(tenantId) {
  return `${tenantId}-`;
}

/**
 * Find the longest common prefix of an array of strings.
 */
function longestCommonPrefix(strings) {
  if (!strings || strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (!strings[i].startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) return '';
  }
  return prefix;
}

/**
 * Build a proposed identifier map from an export artifact and a target tenant ID.
 *
 * @param {Object} artifact - export artifact
 * @param {string} targetTenantId - destination tenant ID
 * @returns {{ source_tenant_id: string, target_tenant_id: string, entries: import('./types.mjs').IdentifierMapEntry[], warnings: string[] }}
 */
export function buildProposedIdentifierMap(artifact, targetTenantId) {
  const sourceTenantId = artifact.tenant_id;
  /** @type {import('./types.mjs').IdentifierMapEntry[]} */
  const entries = [];
  const warnings = [];

  // Build a map of domain_key -> domain data for easy lookup
  const domainMap = new Map();
  if (Array.isArray(artifact.domains)) {
    for (const d of artifact.domains) {
      domainMap.set(d.domain_key, d);
    }
  }

  // IAM realm
  const iamDomain = domainMap.get('iam');
  if (iamDomain && iamDomain.status !== 'error' && iamDomain.status !== 'not_available' && iamDomain.status !== 'not_requested') {
    const sourceRealm = iamDomain.data?.realm ?? sourceTenantId;
    const targetRealm = deriveIamRealm(targetTenantId);
    if (sourceRealm && sourceRealm !== targetRealm) {
      entries.push({ from: sourceRealm, to: targetRealm, scope: 'iam.realm' });
    }
  } else if (!iamDomain || iamDomain.status === 'not_available' || iamDomain.status === 'error') {
    warnings.push('IAM domain not available; skipping realm identifier');
  }

  // PostgreSQL schema
  const pgDomain = domainMap.get('postgres_metadata');
  if (pgDomain && pgDomain.status !== 'error' && pgDomain.status !== 'not_available' && pgDomain.status !== 'not_requested') {
    const sourceSchema = pgDomain.data?.schema ?? derivePgSchema(sourceTenantId);
    const targetSchema = derivePgSchema(targetTenantId);
    if (sourceSchema && sourceSchema !== targetSchema) {
      entries.push({ from: sourceSchema, to: targetSchema, scope: 'postgres.schema' });
    }
  } else if (!pgDomain || pgDomain.status === 'not_available' || pgDomain.status === 'error') {
    warnings.push('PostgreSQL domain not available; skipping schema identifier');
  }

  // MongoDB database
  const mongoDomain = domainMap.get('mongo_metadata');
  if (mongoDomain && mongoDomain.status !== 'error' && mongoDomain.status !== 'not_available' && mongoDomain.status !== 'not_requested') {
    const sourceDb = mongoDomain.data?.database ?? deriveMongoDatabase(sourceTenantId);
    const targetDb = deriveMongoDatabase(targetTenantId);
    if (sourceDb && sourceDb !== targetDb) {
      entries.push({ from: sourceDb, to: targetDb, scope: 'mongo.database' });
    }
  } else if (!mongoDomain || mongoDomain.status === 'not_available' || mongoDomain.status === 'error') {
    warnings.push('MongoDB domain not available; skipping database identifier');
  }

  // Kafka topic prefix
  const kafkaDomain = domainMap.get('kafka');
  if (kafkaDomain && kafkaDomain.status !== 'error' && kafkaDomain.status !== 'not_available' && kafkaDomain.status !== 'not_requested') {
    const topics = kafkaDomain.data?.topics;
    let sourcePrefix = '';
    if (Array.isArray(topics) && topics.length > 0) {
      const topicNames = topics.map(t => t.name).filter(Boolean);
      sourcePrefix = longestCommonPrefix(topicNames);
    }
    if (!sourcePrefix) sourcePrefix = deriveKafkaPrefix(sourceTenantId);
    const targetPrefix = deriveKafkaPrefix(targetTenantId);
    if (sourcePrefix && sourcePrefix !== targetPrefix) {
      entries.push({ from: sourcePrefix, to: targetPrefix, scope: 'kafka.topic_prefix' });
    }
  } else if (!kafkaDomain || kafkaDomain.status === 'not_available' || kafkaDomain.status === 'error') {
    warnings.push('Kafka domain not available; skipping topic prefix identifier');
  }

  // Functions namespace
  const fnDomain = domainMap.get('functions');
  if (fnDomain && fnDomain.status !== 'error' && fnDomain.status !== 'not_available' && fnDomain.status !== 'not_requested') {
    const sourceNs = fnDomain.data?.namespace ?? deriveFunctionsNamespace(sourceTenantId);
    const targetNs = deriveFunctionsNamespace(targetTenantId);
    if (sourceNs && sourceNs !== targetNs) {
      entries.push({ from: sourceNs, to: targetNs, scope: 'functions.namespace' });
    }
  } else if (!fnDomain || fnDomain.status === 'not_available' || fnDomain.status === 'error') {
    warnings.push('Functions domain not available; skipping namespace identifier');
  }

  // Storage bucket prefix
  const storageDomain = domainMap.get('storage');
  if (storageDomain && storageDomain.status !== 'error' && storageDomain.status !== 'not_available' && storageDomain.status !== 'not_requested') {
    const buckets = storageDomain.data?.buckets;
    let sourcePrefix = '';
    if (Array.isArray(buckets) && buckets.length > 0) {
      const bucketNames = buckets.map(b => b.name).filter(Boolean);
      sourcePrefix = longestCommonPrefix(bucketNames);
    }
    if (!sourcePrefix) sourcePrefix = deriveStorageBucketPrefix(sourceTenantId);
    const targetPrefix = deriveStorageBucketPrefix(targetTenantId);
    if (sourcePrefix && sourcePrefix !== targetPrefix) {
      entries.push({ from: sourcePrefix, to: targetPrefix, scope: 'storage.bucket_prefix' });
    }
  } else if (!storageDomain || storageDomain.status === 'not_available' || storageDomain.status === 'error') {
    warnings.push('Storage domain not available; skipping bucket prefix identifier');
  }

  // Add source tenant_id → target tenant_id as a global replacement if different
  if (sourceTenantId && sourceTenantId !== targetTenantId) {
    // Only add if not already covered by a more specific entry
    const alreadyCoveredExactly = entries.some(e => e.from === sourceTenantId);
    if (!alreadyCoveredExactly) {
      entries.push({ from: sourceTenantId, to: targetTenantId, scope: 'tenant_id' });
    }
  }

  return { source_tenant_id: sourceTenantId, target_tenant_id: targetTenantId, entries, warnings };
}

/**
 * Validate an identifier map.
 * Throws an error with details if invalid.
 *
 * @param {{ entries: import('./types.mjs').IdentifierMapEntry[] }} map
 */
export function validateIdentifierMap(map) {
  const errors = [];
  const seenFrom = new Set();

  if (!map || !Array.isArray(map.entries)) {
    throw Object.assign(new Error('identifier_map.entries must be an array'), { code: 'INVALID_IDENTIFIER_MAP', details: ['entries is not an array'] });
  }

  for (let i = 0; i < map.entries.length; i++) {
    const entry = map.entries[i];
    if (!entry.from || typeof entry.from !== 'string') {
      errors.push(`entries[${i}].from is empty or not a string`);
    }
    if (!entry.to || typeof entry.to !== 'string' || entry.to.trim().length === 0) {
      errors.push(`entries[${i}].to is empty or blank`);
    }
    if (entry.from && seenFrom.has(entry.from)) {
      errors.push(`entries[${i}].from '${entry.from}' is duplicate`);
    }
    if (entry.from) seenFrom.add(entry.from);
  }

  if (errors.length > 0) {
    throw Object.assign(new Error(`Invalid identifier map: ${errors.join('; ')}`), { code: 'INVALID_IDENTIFIER_MAP', details: errors });
  }
}

/**
 * Apply an identifier map to an export artifact, returning a deep clone with replacements.
 * Replacements are applied longest-from-first to avoid substring collisions.
 * Strings matching REDACTED_MARKER are not modified.
 *
 * @param {Object} artifact - export artifact (NOT mutated)
 * @param {{ entries: import('./types.mjs').IdentifierMapEntry[] }} map
 * @returns {Object} - transformed deep clone
 */
export function applyIdentifierMap(artifact, map) {
  if (!map || !map.entries || map.entries.length === 0) {
    return structuredClone(artifact);
  }

  // Sort by from length descending (longest first) to avoid partial replacements
  const sortedEntries = [...map.entries].sort((a, b) => b.from.length - a.from.length);

  return _applyRecursive(structuredClone(artifact), sortedEntries);
}

function _applyRecursive(node, sortedEntries) {
  if (node === null || node === undefined) return node;

  if (typeof node === 'string') {
    if (node === REDACTED_MARKER) return node;
    let result = node;
    for (const entry of sortedEntries) {
      if (result.includes(entry.from)) {
        result = result.split(entry.from).join(entry.to);
      }
    }
    return result;
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = _applyRecursive(node[i], sortedEntries);
    }
    return node;
  }

  if (typeof node === 'object') {
    for (const key of Object.keys(node)) {
      node[key] = _applyRecursive(node[key], sortedEntries);
    }
    return node;
  }

  return node;
}
