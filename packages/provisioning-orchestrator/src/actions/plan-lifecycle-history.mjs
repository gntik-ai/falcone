import * as planRepository from '../repositories/plan-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400, PLAN_NOT_FOUND: 404 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  try {
    requireSuperadmin(params);
    const page = paginationValue(params.page, 1);
    const pageSize = paginationValue(params.pageSize, 20, 100);
    const db = overrides.db ?? params.db;
    const existing = await planRepository.findById(db, params.planId);
    if (!existing) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS total FROM plan_audit_events
       WHERE action_type = 'plan.lifecycle_transitioned' AND plan_id = $1`, [params.planId]
    );
    const { rows } = await db.query(
      `SELECT id, plan_id, previous_state, new_state, actor_id, correlation_id, created_at
       FROM plan_audit_events
       WHERE action_type = 'plan.lifecycle_transitioned' AND plan_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`, [params.planId, pageSize, (page - 1) * pageSize]
    );
    const items = rows.map(row => ({
      id: row.id,
      planId: row.plan_id,
      previousStatus: row.previous_state?.status ?? null,
      newStatus: row.new_state.status,
      transitionedAt: new Date(row.created_at).toISOString(),
      actorId: row.actor_id,
      correlationId: row.correlation_id
    }));
    return { statusCode: 200, body: { items, total: Number(countRows[0].total), page, pageSize } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}

function paginationValue(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null) return fallback;
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
    throw Object.assign(new Error('Invalid pagination'), { code: 'VALIDATION_ERROR' });
  }
  return Number(value);
}
