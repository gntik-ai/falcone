import { TOPICS, buildAssignedEvent } from '../events/privilege-domain-events.mjs';

function classifyFromPath(path = '') {
  if (/^\/v1\/(collections|objects|analytics\/query|events\/publish|events\/subscribe)/.test(path) || /^\/v1\/functions\/[^/]+\/invoke$/.test(path)) return 'data_access';
  if (/^\/v1\/(tenants|workspaces|schemas|api-keys|services\/configure|quotas)/.test(path) || /^\/v1\/functions(\/[^/]+(\/config)?)?$/.test(path)) return 'structural_admin';
  return 'pending_classification';
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_BATCH_SIZE = 500;

function resolveBatchSize() {
  const raw = process.env.APIKEY_DOMAIN_MIGRATION_BATCH_SIZE;
  if (raw !== undefined) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_BATCH_SIZE;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const publishEvent = overrides.publishEvent ?? (async () => {});
  const log = overrides.log ?? console;

  const batchSize = resolveBatchSize();
  let lastId = NIL_UUID;
  let classified = 0;
  let pending = 0;
  // alreadyClassified is always 0: classified rows are excluded at the SQL level
  // (WHERE privilege_domain IS NULL), so they are never returned to the application.
  const alreadyClassified = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await db.query(
      `SELECT id, tenant_id, workspace_id, last_used_endpoint_category, last_used_path FROM api_keys WHERE privilege_domain IS NULL AND id > $1 ORDER BY id ASC LIMIT $2`,
      [lastId, batchSize]
    );

    const batch = result.rows;
    if (batch.length === 0) break;

    // Classify each row in the batch
    const assignments = batch.map(row => {
      const classification = row.last_used_endpoint_category && ['structural_admin', 'data_access'].includes(row.last_used_endpoint_category)
        ? row.last_used_endpoint_category
        : classifyFromPath(row.last_used_path);
      return { row, classification };
    });

    // Build multi-row UPDATE: UPDATE api_keys AS k SET privilege_domain = v.pd
    //   FROM (VALUES ($1::uuid,$2::text), ...) AS v(id, pd)
    //   WHERE k.id = v.id AND k.privilege_domain IS NULL
    const valuePlaceholders = assignments.map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::text)`).join(', ');
    const flatParams = assignments.flatMap(({ row, classification }) => [row.id, classification]);
    await db.query(
      `UPDATE api_keys AS k SET privilege_domain = v.pd FROM (VALUES ${valuePlaceholders}) AS v(id, pd) WHERE k.id = v.id AND k.privilege_domain IS NULL`,
      flatParams
    );

    // Emit events and accumulate counters
    for (const { row, classification } of assignments) {
      if (classification === 'pending_classification') {
        pending += 1;
        await publishEvent(TOPICS.ASSIGNED, buildAssignedEvent({ tenantId: row.tenant_id, workspaceId: row.workspace_id, memberId: row.id, privilegeDomain: 'data_access', assignedBy: row.id, pending_review: true }));
      } else {
        classified += 1;
      }
    }

    lastId = batch[batch.length - 1].id;

    // If we got fewer rows than the batch size, there are no more rows to process.
    if (batch.length < batchSize) break;
  }

  if (pending > 0 && Number(process.env.APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS ?? '14') <= 0) {
    log.warn?.({ event: 'api_key_domain_migration_grace_period_elapsed', pending });
  }
  return { statusCode: 200, body: { classified, pending, alreadyClassified } };
}
