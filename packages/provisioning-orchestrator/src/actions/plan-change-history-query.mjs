import * as historyRepository from '../repositories/plan-change-history-repository.mjs';
import { plan_change_history_query_duration_ms, recordMetric } from '../observability/plan-change-impact-metrics.mjs';

function requireInternal(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || !['superadmin', 'internal'].includes(actor.type)) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', statusCode: 403 });
  return actor;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const metricRecorder = overrides.metricRecorder ?? params.metricRecorder;
  const startedAt = Date.now();
  requireInternal(params);
  if (!params.tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'VALIDATION_ERROR', statusCode: 400 });
  const page = await historyRepository.queryHistoryByTenant(db, params.tenantId, {
    page: params.page,
    pageSize: params.pageSize,
    actorId: params.actorId,
    from: params.from,
    to: params.to
  });
  recordMetric(metricRecorder, plan_change_history_query_duration_ms, Date.now() - startedAt, {});
  return { statusCode: 200, body: page };
}
