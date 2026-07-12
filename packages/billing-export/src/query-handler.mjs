/**
 * Query handler backing the platform-admin billing usage routes:
 *   GET /v1/platform/billing/usage             (paginated, all tenants)
 *   GET /v1/platform/billing/usage/{tenantId}  (single-tenant filtered)
 *
 * Authorization is enforced here at the handler layer (in addition to the
 * gateway `scope-enforcement` plugin): only platform-admin actors
 * (superadmin / sre actor types, internal service actors, or the
 * `platform_admin` role) may read usage records. Every query is parameterized;
 * the tenant-scoped variant binds `tenant_id` so no cross-tenant rows leak.
 *
 * Dependency-injected (`deps.db`) so the SQL contract is black-box testable.
 */

const ALLOWED_ACTOR_TYPES = new Set(['superadmin', 'sre', 'internal']);
const ALLOWED_ROLES = new Set(['superadmin', 'sre', 'platform_admin']);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function isPlatformAdmin(actor = {}) {
  if (ALLOWED_ACTOR_TYPES.has(actor.type ?? actor.role)) return true;
  const roles = Array.isArray(actor.roles) ? actor.roles : [];
  return roles.some((role) => ALLOWED_ROLES.has(role));
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

function clampOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

export async function main(params = {}, deps = {}) {
  const db = deps.db ?? params.db;
  const actor = params.callerContext?.actor ?? {};

  if (!actor.id || !isPlatformAdmin(actor)) {
    const err = new Error('Forbidden: requires platform-admin scope');
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const tenantId = params.tenantId ?? null;

  let result;
  if (tenantId) {
    result = await db.query(
      `SELECT * FROM billing_usage_records
       WHERE tenant_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset]
    );
  } else {
    result = await db.query(
      `SELECT * FROM billing_usage_records
       ORDER BY created_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
  }

  return {
    statusCode: 200,
    body: {
      records: result?.rows ?? [],
      pagination: {
        limit,
        offset,
        total: result?.rowCount ?? (result?.rows?.length ?? 0)
      }
    }
  };
}
