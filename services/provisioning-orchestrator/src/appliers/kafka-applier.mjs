/**
 * Kafka domain applier for tenant config reprovision.
 * @module appliers/kafka-applier
 */

import { compareResources, resolveAction, buildDiff } from '../reprovision/diff.mjs';
import { REDACTED_MARKER, zeroCounts } from '../reprovision/types.mjs';

const RELEVANT_CONFIG_KEYS = ['retention.ms', 'cleanup.policy', 'min.insync.replicas'];

/**
 * @param {string} tenantId
 * @param {Object} domainData
 * @param {Object} options
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'kafka';

  if (!domainData || _isEmpty(domainData)) {
    return { domain_key, status: 'applied', resource_results: [], counts: zeroCounts(), message: 'empty domain' };
  }

  const counts = zeroCounts();
  const resource_results = [];
  let hasWarnings = false;

  const admin = credentials.kafkaAdmin ?? null;

  // Process topics
  const topics = domainData.topics;
  if (Array.isArray(topics)) {
    for (const topic of topics) {
      try {
        const result = await _processTopic(topic, { dryRun, admin, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
        if (result.warnings.length > 0) hasWarnings = true;
      } catch (err) {
        resource_results.push({
          resource_type: 'topic',
          resource_name: topic.name ?? 'unknown',
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

  // Process ACLs
  const acls = domainData.acls;
  if (Array.isArray(acls)) {
    for (const acl of acls) {
      try {
        const result = await _processAcl(acl, { dryRun, admin, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
      } catch (err) {
        resource_results.push({
          resource_type: 'acl',
          resource_name: `${acl.principal}/${acl.operation}/${acl.resourceName ?? ''}`,
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

  // Process consumer groups (metadata only)
  const consumerGroups = domainData.consumer_groups;
  if (Array.isArray(consumerGroups)) {
    for (const group of consumerGroups) {
      resource_results.push({
        resource_type: 'consumer_group',
        resource_name: group.groupId ?? group.name ?? 'unknown',
        resource_id: null,
        action: dryRun ? 'would_skip' : 'skipped',
        message: 'Consumer group metadata is informational only; groups are created on first consumer connection',
        warnings: [],
        diff: null,
      });
      counts.skipped++;
    }
  }

  const status = _resolveStatus(counts, dryRun, hasWarnings);
  return { domain_key, status, resource_results, counts, message: null };
}

async function _processTopic(topic, { dryRun, admin, log }) {
  const name = topic.name ?? 'unknown';
  const warnings = [];
  const cleanedTopic = _stripRedacted(topic, warnings, name);

  if (!admin) throw new Error('No Kafka admin client configured for reprovision');

  // Check if topic exists
  const existingTopics = await admin.listTopics();
  const exists = existingTopics.includes(name);

  if (!exists) {
    const action = dryRun ? 'would_create' : 'created';
    if (!dryRun) {
      await admin.createTopics({
        topics: [{
          topic: name,
          numPartitions: cleanedTopic.numPartitions ?? 1,
          replicationFactor: cleanedTopic.replicationFactor ?? 1,
          configEntries: _buildConfigEntries(cleanedTopic.configEntries ?? cleanedTopic.config ?? {}),
        }],
      });
    }
    const finalAction = warnings.length > 0 ? (dryRun ? 'would_create' : 'applied_with_warnings') : action;
    return { resource_type: 'topic', resource_name: name, resource_id: null, action: finalAction, message: null, warnings, diff: null };
  }

  // Topic exists — compare configuration
  const topicMetadata = await admin.fetchTopicMetadata({ topics: [name] });
  const existingPartitions = topicMetadata.topics?.[0]?.partitions?.length ?? 0;

  // Partition count difference is always a conflict (can't reduce partitions)
  if (cleanedTopic.numPartitions && cleanedTopic.numPartitions !== existingPartitions) {
    const diff = buildDiff({ numPartitions: existingPartitions }, { numPartitions: cleanedTopic.numPartitions });
    return {
      resource_type: 'topic', resource_name: name, resource_id: null,
      action: dryRun ? 'would_conflict' : 'conflict',
      message: `Topic partition count differs (existing: ${existingPartitions}, desired: ${cleanedTopic.numPartitions})`,
      warnings, diff,
    };
  }

  // Compare config entries
  const desiredConfig = _normalizeConfig(cleanedTopic.configEntries ?? cleanedTopic.config ?? {});
  const existingConfig = {};
  try {
    const configRes = await admin.describeConfigs({ resources: [{ type: 2 /* TOPIC */, name }] });
    for (const entry of configRes.resources?.[0]?.configEntries ?? []) {
      if (RELEVANT_CONFIG_KEYS.includes(entry.configName)) {
        existingConfig[entry.configName] = entry.configValue;
      }
    }
  } catch { /* ignore config fetch errors */ }

  const comparison = compareResources(existingConfig, desiredConfig, []);
  const action = resolveAction(true, comparison, dryRun);
  const diff = (action === 'conflict' || action === 'would_conflict') ? buildDiff(existingConfig, desiredConfig) : null;

  return { resource_type: 'topic', resource_name: name, resource_id: null, action, message: null, warnings, diff };
}

async function _processAcl(acl, { dryRun, admin, log }) {
  const name = `${acl.principal}/${acl.operation}/${acl.resourceName ?? ''}`;
  const warnings = [];

  if (!admin) throw new Error('No Kafka admin client configured for reprovision');

  // Check if ACL exists
  const existingAcls = await admin.describeAcls({
    resourceType: acl.resourceType,
    resourceName: acl.resourceName,
    resourcePatternType: acl.resourcePatternType ?? acl.patternType,
    principal: acl.principal,
    operation: acl.operation,
    permissionType: acl.permissionType,
  });

  const exists = existingAcls.resources?.length > 0;
  const action = resolveAction(exists, exists ? 'equal' : 'different', dryRun);

  if (action === 'created' && !dryRun) {
    await admin.createAcls({ acl: [acl] });
  }

  return { resource_type: 'acl', resource_name: name, resource_id: null, action, message: null, warnings, diff: null };
}

function _buildConfigEntries(config) {
  if (Array.isArray(config)) return config;
  return Object.entries(config).map(([name, value]) => ({ name, value: String(value) }));
}

function _normalizeConfig(config) {
  const normalized = {};
  if (Array.isArray(config)) {
    for (const entry of config) {
      if (RELEVANT_CONFIG_KEYS.includes(entry.name ?? entry.configName)) {
        normalized[entry.name ?? entry.configName] = String(entry.value ?? entry.configValue);
      }
    }
  } else {
    for (const [key, val] of Object.entries(config)) {
      if (RELEVANT_CONFIG_KEYS.includes(key)) {
        normalized[key] = String(val);
      }
    }
  }
  return normalized;
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
  const hasTopics = Array.isArray(domainData.topics) && domainData.topics.length > 0;
  const hasAcls = Array.isArray(domainData.acls) && domainData.acls.length > 0;
  const hasGroups = Array.isArray(domainData.consumer_groups) && domainData.consumer_groups.length > 0;
  return !hasTopics && !hasAcls && !hasGroups;
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
