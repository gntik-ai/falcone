/**
 * Kafka configuration collector.
 * Extracts topics, ACLs, and consumer groups scoped to a tenant.
 * @module collectors/kafka-collector
 */

import { redactSensitiveFields } from './types.mjs';

const DOMAIN_KEY = 'kafka';

/**
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {Object} [options.kafkaAdmin] - injectable kafkajs Admin client for testing
 * @returns {Promise<import('./types.mjs').CollectorResult>}
 */
export async function collect(tenantId, options = {}) {
  const exportedAt = new Date().toISOString();

  const brokers = process.env.CONFIG_EXPORT_KAFKA_BROKERS;
  if (!brokers) {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'Kafka brokers not configured', data: null };
  }

  let admin = options.kafkaAdmin ?? null;
  let shouldDisconnect = false;

  try {
    if (!admin) {
      const { Kafka } = await import('kafkajs');
      const kafka = new Kafka({
        brokers: brokers.split(','),
        ...(process.env.CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME ? {
          sasl: {
            mechanism: 'plain',
            username: process.env.CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME,
            password: process.env.CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD ?? '',
          },
        } : {}),
      });
      admin = kafka.admin();
      await admin.connect();
      shouldDisconnect = true;
    }

    const tenantTopicPrefix = `${tenantId}.`;
    const tenantCgPrefix = `${tenantId}.cg.`;

    // Topics
    const topicsMeta = await admin.fetchTopicMetadata();
    const tenantTopics = topicsMeta.topics.filter(t => t.name.startsWith(tenantTopicPrefix));

    const topics = [];
    for (const t of tenantTopics) {
      let configEntries = [];
      try {
        const configs = await admin.describeConfigs({
          includeSynonyms: false,
          resources: [{ type: /** @type {any} */ (2), name: t.name }],
        });
        configEntries = configs.resources?.[0]?.configEntries?.filter(e => e.isReadOnly === false) ?? [];
      } catch { /* some brokers restrict describeConfigs */ }

      topics.push({
        name: t.name,
        partitions: t.partitions.length,
        replication_factor: t.partitions[0]?.replicas?.length ?? 1,
        config_overrides: configEntries.reduce((acc, e) => { acc[e.configName] = e.configValue; return acc; }, {}),
      });
    }

    // ACLs
    let acls = [];
    try {
      const aclResult = await admin.describeAcls({
        resourceType: /** @type {any} */ (2), // TOPIC
        resourcePatternType: /** @type {any} */ (3), // LITERAL
        resourceName: undefined,
        principal: undefined,
        host: undefined,
        operation: undefined,
        permissionType: undefined,
      });
      // Client-side filter by tenant prefix
      acls = (aclResult.resources ?? [])
        .filter(r => r.resourceName?.startsWith(tenantTopicPrefix))
        .flatMap(r => r.acls.map(a => ({ resource: r.resourceName, ...a })));
    } catch { /* ACL API may not be available */ }

    // Consumer groups
    let consumerGroups = [];
    try {
      const groupList = await admin.listGroups();
      const tenantGroups = (groupList.groups ?? []).filter(g => g.groupId.startsWith(tenantCgPrefix));
      for (const g of tenantGroups) {
        let state = g.protocolType ?? 'unknown';
        let memberCount = 0;
        try {
          const desc = await admin.describeGroups([g.groupId]);
          const d = desc.groups?.[0];
          state = d?.state ?? state;
          memberCount = d?.members?.length ?? 0;
        } catch { /* ignore */ }
        consumerGroups.push({ group_id: g.groupId, state, member_count: memberCount });
      }
    } catch { /* ignore */ }

    if (topics.length === 0 && acls.length === 0 && consumerGroups.length === 0) {
      return { domain_key: DOMAIN_KEY, status: 'empty', exported_at: exportedAt, items_count: 0, data: { topics: [], acls: [], consumer_groups: [] } };
    }

    const data = redactSensitiveFields({ topics, acls, consumer_groups: consumerGroups });
    return { domain_key: DOMAIN_KEY, status: 'ok', exported_at: exportedAt, items_count: topics.length + acls.length + consumerGroups.length, data };
  } catch (err) {
    return { domain_key: DOMAIN_KEY, status: 'error', exported_at: exportedAt, error: err.message, data: null };
  } finally {
    if (shouldDisconnect && admin) {
      try { await admin.disconnect(); } catch { /* ignore */ }
    }
  }
}
