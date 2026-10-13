import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400 };
const OWNER_TYPES = new Set(['tenant_owner', 'tenant-owner', 'tenant']);

function resolveTenantId(params) {
  const actor = params.callerContext?.actor;
  const tenantId = actor?.tenantId ?? actor?.tenant?.id;
  if (!actor?.id || !OWNER_TYPES.has(actor.type) || !tenantId
      || (params.tenantId !== undefined && params.tenantId !== tenantId)) {
    throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  }
  return tenantId;
}

function paginationInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const input = value === undefined ? fallback : value;
  const integer = typeof input === 'number' ? input
    : typeof input === 'string' && /^[1-9][0-9]*$/.test(input) ? Number(input) : NaN;
  if (!Number.isSafeInteger(integer) || integer < 1 || integer > maximum) {
    throw Object.assign(new Error('Invalid pagination'), { code: 'VALIDATION_ERROR' });
  }
  return integer;
}

export async function main(params = {}, overrides = {}) {
  try {
    const tenantId = resolveTenantId(params);
    const page = paginationInteger(params.page, 1);
    const pageSize = paginationInteger(params.pageSize, 20, 100);
    const history = await assignmentRepository.getHistory(overrides.db ?? params.db, tenantId, { page, pageSize });
    return {
      statusCode: 200,
      body: {
        tenantId,
        assignments: history.assignments.map(({ assignmentId, planId, planSlug, planDisplayName, planStatus, effectiveFrom, supersededAt }) =>
          ({ assignmentId, planId, planSlug, planDisplayName, planStatus, effectiveFrom, supersededAt })),
        total: history.total,
        page: history.page,
        pageSize: history.pageSize
      }
    };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
