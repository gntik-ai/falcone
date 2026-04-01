/**
 * MongoDB metadata domain applier for tenant config reprovision.
 * @module appliers/mongo-applier
 */

import { compareResources, resolveAction, buildDiff } from '../reprovision/diff.mjs';
import { REDACTED_MARKER, zeroCounts } from '../reprovision/types.mjs';

const RESOURCE_TYPES = ['collections', 'indexes'];

/**
 * @param {string} tenantId
 * @param {Object} domainData
 * @param {Object} options
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'mongo_metadata';

  if (!domainData || _isEmpty(domainData)) {
    return { domain_key, status: 'applied', resource_results: [], counts: zeroCounts(), message: 'empty domain' };
  }

  const counts = zeroCounts();
  const resource_results = [];
  let hasWarnings = false;

  const mongoClient = credentials.mongoClient ?? null;
  const database = domainData.database ?? tenantId.replace(/-/g, '_');

  const getDb = credentials.getDb ?? (() => {
    if (!mongoClient) throw new Error('No MongoDB client configured for reprovision');
    return mongoClient.db(database);
  });

  // Process collections
  const collections = domainData.collections;
  if (Array.isArray(collections)) {
    for (const item of collections) {
      try {
        const result = await _processCollection(item, { dryRun, getDb, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
        if (result.warnings.length > 0) hasWarnings = true;
      } catch (err) {
        resource_results.push({
          resource_type: 'collection',
          resource_name: item.name ?? 'unknown',
          resource_id: null,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        });
        counts.errors++;
      }
    }
  }

  // Process indexes
  const indexes = domainData.indexes;
  if (Array.isArray(indexes)) {
    for (const item of indexes) {
      try {
        const result = await _processIndex(item, { dryRun, getDb, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
        if (result.warnings.length > 0) hasWarnings = true;
      } catch (err) {
        resource_results.push({
          resource_type: 'index',
          resource_name: item.name ?? `${item.collection}.${JSON.stringify(item.key)}`,
          resource_id: null,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        });
        counts.errors++;
      }
    }
  }

  // Sharding metadata — report as conflict if present but target not sharded
  if (domainData.sharding) {
    resource_results.push({
      resource_type: 'sharding',
      resource_name: 'sharding_config',
      resource_id: null,
      action: dryRun ? 'would_conflict' : 'conflict',
      message: 'Sharding metadata present in artifact but sharding configuration must be applied manually',
      warnings: [],
      diff: null,
    });
    counts.conflicts++;
  }

  const status = _resolveStatus(counts, dryRun, hasWarnings);
  return { domain_key, status, resource_results, counts, message: null };
}

async function _processCollection(item, { dryRun, getDb, log }) {
  const name = item.name ?? 'unknown';
  const warnings = [];
  const cleanedItem = _stripRedacted(item, warnings, name);

  const db = getDb();
  const existingCollections = await db.listCollections({ name }).toArray();
  const exists = existingCollections.length > 0;

  let comparison = 'different';
  let existingData = null;
  if (exists) {
    existingData = existingCollections[0];
    const existingValidator = existingData.options?.validator ?? null;
    const desiredValidator = cleanedItem.validator ?? null;
    comparison = compareResources(
      { name, validator: existingValidator },
      { name, validator: desiredValidator },
      []
    );
  }

  const action = resolveAction(exists, comparison, dryRun);

  if (action === 'created' && !dryRun) {
    const opts = {};
    if (cleanedItem.validator) opts.validator = cleanedItem.validator;
    await db.createCollection(name, opts);
  }

  const diff = (action === 'conflict' || action === 'would_conflict')
    ? buildDiff(existingData, cleanedItem)
    : null;

  const finalAction = warnings.length > 0 && (action === 'created' || action === 'would_create')
    ? (dryRun ? 'would_create' : 'applied_with_warnings')
    : action;

  return { resource_type: 'collection', resource_name: name, resource_id: null, action: finalAction, message: null, warnings, diff };
}

async function _processIndex(item, { dryRun, getDb, log }) {
  const name = item.name ?? `${item.collection}.${JSON.stringify(item.key)}`;
  const warnings = [];
  const cleanedItem = _stripRedacted(item, warnings, name);

  const db = getDb();
  const collection = db.collection(item.collection);
  const existingIndexes = await collection.listIndexes().toArray();
  const matchingIndex = existingIndexes.find(idx => {
    if (item.name && idx.name === item.name) return true;
    return JSON.stringify(idx.key) === JSON.stringify(item.key);
  });

  const exists = matchingIndex !== null && matchingIndex !== undefined;
  let comparison = 'different';
  if (exists) {
    comparison = compareResources(
      { key: matchingIndex.key, unique: matchingIndex.unique ?? false, sparse: matchingIndex.sparse ?? false },
      { key: item.key, unique: item.unique ?? false, sparse: item.sparse ?? false },
      ['v', 'ns']
    );
  }

  const action = resolveAction(exists, comparison, dryRun);

  if (action === 'created' && !dryRun) {
    const indexOpts = {};
    if (item.name) indexOpts.name = item.name;
    if (item.unique) indexOpts.unique = true;
    if (item.sparse) indexOpts.sparse = true;
    await collection.createIndex(item.key, indexOpts);
  }

  const diff = (action === 'conflict' || action === 'would_conflict')
    ? buildDiff(matchingIndex, cleanedItem)
    : null;

  const finalAction = warnings.length > 0 && (action === 'created' || action === 'would_create')
    ? (dryRun ? 'would_create' : 'applied_with_warnings')
    : action;

  return { resource_type: 'index', resource_name: name, resource_id: null, action: finalAction, message: null, warnings, diff };
}

function _stripRedacted(item, warnings, resourceName) {
  const clone = structuredClone(item);
  _walk(clone, [], warnings, resourceName);
  return clone;
}

function _walk(obj, path, warnings, resourceName) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, val] of Object.entries(obj)) {
    if (val === REDACTED_MARKER) {
      delete obj[key];
      warnings.push(`Redacted field '${[...path, key].join('.')}' omitted for resource '${resourceName}'`);
    } else if (typeof val === 'object' && val !== null) {
      _walk(val, [...path, key], warnings, resourceName);
    }
  }
}

function _isEmpty(domainData) {
  for (const rt of RESOURCE_TYPES) {
    if (Array.isArray(domainData[rt]) && domainData[rt].length > 0) return false;
  }
  // Also check sharding metadata
  if (domainData.sharding) return false;
  return true;
}

function _updateCounts(counts, action) {
  if (action === 'created' || action === 'would_create' || action === 'applied_with_warnings') counts.created++;
  else if (action === 'skipped' || action === 'would_skip') counts.skipped++;
  else if (action === 'conflict' || action === 'would_conflict') counts.conflicts++;
  else if (action === 'error') counts.errors++;
}

function _resolveStatus(counts, dryRun, hasWarnings) {
  if (counts.errors > 0 && counts.created === 0 && counts.skipped === 0 && counts.conflicts === 0) return 'error';
  if (counts.conflicts > 0 && counts.created === 0) return dryRun ? 'would_conflict' : 'conflict';
  if (hasWarnings) return dryRun ? 'would_apply_with_warnings' : 'applied_with_warnings';
  if (counts.created > 0) return dryRun ? 'would_apply' : 'applied';
  return dryRun ? 'would_skip' : 'skipped';
}
