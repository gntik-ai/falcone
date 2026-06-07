/**
 * Pure helper for per-tenant Kafka topic routing.
 * No kafkajs dependency — safe to load in test environments.
 *
 * Rules:
 *   domain === 'tenant'  → `${baseTopic}.${event.tenantId}`
 *   otherwise            → `${baseTopic}.platform`
 *
 * NEVER returns the bare baseTopic.
 */

/**
 * @param {string} baseTopic - The base/prefix topic (e.g. 'console.secrets.audit')
 * @param {{ domain: string, tenantId?: string|null }} event
 * @returns {string} The resolved per-tenant or per-domain topic name
 */
export function resolveAuditTopic(baseTopic, event) {
  if (event.domain === 'tenant') {
    return `${baseTopic}.${event.tenantId}`;
  }
  return `${baseTopic}.platform`;
}
