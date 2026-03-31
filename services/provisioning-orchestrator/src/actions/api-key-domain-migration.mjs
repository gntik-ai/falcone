import { TOPICS, buildAssignedEvent } from '../events/privilege-domain-events.mjs';

function classifyFromPath(path = '') {
  if (/^\/v1\/(collections|objects|analytics\/query|events\/publish|events\/subscribe)/.test(path) || /^\/v1\/functions\/[^/]+\/invoke$/.test(path)) return 'data_access';
  if (/^\/v1\/(tenants|workspaces|schemas|api-keys|services\/configure|quotas)/.test(path) || /^\/v1\/functions(\/[^/]+(\/config)?)?$/.test(path)) return 'structural_admin';
  return 'pending_classification';
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const publishEvent = overrides.publishEvent ?? (async () => {});
  const log = overrides.log ?? console;
  const result = await db.query(`SELECT id, tenant_id, workspace_id, last_used_endpoint_category, last_used_path, privilege_domain FROM api_keys`);
  let classified = 0;
  let pending = 0;
  let alreadyClassified = 0;
  for (const row of result.rows) {
    if (row.privilege_domain) {
      alreadyClassified += 1;
      continue;
    }
    const classification = row.last_used_endpoint_category && ['structural_admin', 'data_access'].includes(row.last_used_endpoint_category)
      ? row.last_used_endpoint_category
      : classifyFromPath(row.last_used_path);
    await db.query(`UPDATE api_keys SET privilege_domain = $2 WHERE id = $1 AND privilege_domain IS NULL`, [row.id, classification]);
    if (classification === 'pending_classification') {
      pending += 1;
      await publishEvent(TOPICS.ASSIGNED, buildAssignedEvent({ tenantId: row.tenant_id, workspaceId: row.workspace_id, memberId: row.id, privilegeDomain: 'data_access', assignedBy: row.id, pending_review: true }));
    } else {
      classified += 1;
    }
  }
  if (pending > 0 && Number(process.env.APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS ?? '14') <= 0) {
    log.warn?.({ event: 'api_key_domain_migration_grace_period_elapsed', pending });
  }
  return { statusCode: 200, body: { classified, pending, alreadyClassified } };
}
