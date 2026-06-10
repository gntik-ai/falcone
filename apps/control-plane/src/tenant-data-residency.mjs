/**
 * Per-tenant data residency — provisioning-input validation, persistence,
 * region discovery, and control-plane cross-region enforcement.
 *
 * Feature: add-data-residency-pinning (issue #272).
 *
 * Falcone has no in-repo HTTP tenant-create handler — tenant creation flows
 * through console workflows (WF-CON-002), and `tenant-management.mjs` is a
 * purge/summary helper, not a CRUD API. So the tenant-facing residency behavior
 * is delivered as `main(params, overrides)`-style action helpers (modeled on
 * `iam-tenant-roles.mjs`): pure validation usable at provisioning input time,
 * db-injected persist/read helpers, a discovery handler for
 * `GET /v1/platform/topology/regions`, and a control-plane enforcement check.
 *
 * The supported-regions catalog is derived from `deployment-topology.json`
 * (single source of truth) — today exactly `["eu-west-1"]`.
 *
 * Cross-region enforcement is delivered here as an exported, injectable check
 * (`enforceResidency`) rather than literal gateway middleware: the gateway/
 * request-pipeline half is infra-bound and wires this check in, just as the
 * tenant-custom-rbac feature delivered validation while deferring the gateway
 * scope-enforcement half. The 403 RESIDENCY_VIOLATION shape and the
 * `residency_violation` audit event are fully specified and tested here.
 *
 * @module tenant-data-residency
 */

import {
  getSupportedRegions,
  isSupportedRegion
} from '../../../services/internal-contracts/src/index.mjs';

/** Audit event category aligned with the observability-audit-pipeline roster. */
export const RESIDENCY_VIOLATION_CATEGORY = 'residency_violation';

function errorBody(code, message, extra = {}) {
  return { code, error: message, ...extra };
}

/**
 * Resolve the supported-regions catalog, allowing an injected override (used by
 * tests to simulate a multi-region deployment without mutating the contract).
 *
 * @param {object} [overrides]
 * @param {string[]} [overrides.supportedRegions]
 * @returns {string[]}
 */
function resolveCatalog(overrides = {}) {
  return overrides.supportedRegions ?? getSupportedRegions();
}

/**
 * Pure validation of a tenant provisioning input's residency region against the
 * supported-regions catalog. Used at provisioning input time.
 *
 * @param {object} input
 * @param {string} input.region - the requested `dataResidency.region`
 * @param {object} [overrides]
 * @param {string[]} [overrides.supportedRegions]
 * @returns {{ ok: true, region: string } | { ok: false, statusCode: 400, body: object }}
 */
export function validateResidencyRegion(input = {}, overrides = {}) {
  const region = input.region;
  const catalog = resolveCatalog(overrides);

  if (typeof region !== 'string' || region.trim() === '') {
    return {
      ok: false,
      statusCode: 400,
      body: errorBody('INVALID_RESIDENCY_REGION', 'dataResidency.region must be a non-empty region identifier.', {
        supported_regions: catalog
      })
    };
  }

  if (!catalog.includes(region)) {
    return {
      ok: false,
      statusCode: 400,
      body: errorBody(
        'UNSUPPORTED_RESIDENCY_REGION',
        `Residency region '${region}' is not in the supported-regions catalog.`,
        { region, supported_regions: catalog }
      )
    };
  }

  return { ok: true, region };
}

/**
 * Persist the validated residency region onto the tenant record via an injected
 * db. Refuses (no write) when the region is unsupported, so no tenant record is
 * created/updated for an invalid region.
 *
 * The db must expose `setResidency(tenantId, region) -> row` (or a deployment
 * adapter mapping to the `data_residency_region` column).
 *
 * @param {object} input
 * @param {string} input.tenantId
 * @param {string} input.region
 * @param {object} [overrides]
 * @param {object} [overrides.db]
 * @param {string[]} [overrides.supportedRegions]
 * @returns {Promise<{ ok: true, region: string, row: object } | { ok: false, statusCode: number, body: object }>}
 */
export async function applyResidencyToTenantRecord(input = {}, overrides = {}) {
  const db = overrides.db ?? input.db;
  if (!db || typeof db.setResidency !== 'function') {
    return { ok: false, statusCode: 500, body: errorBody('CONFIG_ERROR', 'Tenant residency storage is not configured.') };
  }

  const validation = validateResidencyRegion({ region: input.region }, overrides);
  if (!validation.ok) {
    // Refuse BEFORE any write — no tenant record is created for an invalid region.
    return validation;
  }

  const row = await db.setResidency(input.tenantId, validation.region);
  return { ok: true, region: validation.region, row };
}

/**
 * Read a tenant's persisted residency region via an injected db. The db must
 * expose `getResidency(tenantId) -> string|null`.
 *
 * @param {object} input
 * @param {string} input.tenantId
 * @param {object} [overrides]
 * @param {object} [overrides.db]
 * @returns {Promise<{ region: string|null }>}
 */
export async function readTenantResidency(input = {}, overrides = {}) {
  const db = overrides.db ?? input.db;
  if (!db || typeof db.getResidency !== 'function') {
    throw new Error('Tenant residency storage is not configured.');
  }
  const region = await db.getResidency(input.tenantId);
  return { region: region ?? null };
}

/**
 * Handler for `GET /v1/platform/topology/regions` — returns the supported-
 * regions catalog so integrations can enumerate valid `dataResidency.region`
 * values before provisioning.
 *
 * @param {object} [params]
 * @param {object} [overrides]
 * @param {string[]} [overrides.supportedRegions]
 * @returns {Promise<{ statusCode: 200, body: { regions: string[] } }>}
 */
export async function listSupportedRegions(params = {}, overrides = {}) {
  const regions = resolveCatalog(overrides);
  return { statusCode: 200, body: { regions } };
}

/**
 * Control-plane cross-region enforcement check.
 *
 * Pass-through (allowed) when the tenant has no pinned region (null/undefined)
 * OR when `requestedRegion` matches the pinned region. Otherwise returns a 403
 * RESIDENCY_VIOLATION and emits a `residency_violation` audit event carrying
 * `tenantId`, `pinnedRegion`, and `requestedRegion`.
 *
 * @param {object} args
 * @param {{ tenantId: string, dataResidencyRegion: string|null }} args.tenant
 * @param {string} args.requestedRegion
 * @param {{ emit: (event: object) => Promise<void>|void }} [args.auditEmitter]
 * @returns {Promise<{ allowed: true, statusCode?: 200 } | { allowed: false, statusCode: 403, body: object }>}
 */
export async function enforceResidency({ tenant, requestedRegion, auditEmitter } = {}) {
  const pinnedRegion = tenant?.dataResidencyRegion ?? null;

  // Backward compatibility: unpinned tenants are exempt.
  if (pinnedRegion === null || pinnedRegion === undefined) {
    return { allowed: true, statusCode: 200 };
  }

  // In-region request: proceed normally, no event.
  if (requestedRegion === pinnedRegion) {
    return { allowed: true, statusCode: 200 };
  }

  // Boundary crossing: reject and audit.
  const event = {
    category: RESIDENCY_VIOLATION_CATEGORY,
    eventType: 'tenant.residency.violation',
    tenantId: tenant.tenantId,
    pinnedRegion,
    requestedRegion: requestedRegion ?? null
  };

  if (auditEmitter && typeof auditEmitter.emit === 'function') {
    await auditEmitter.emit(event);
  }

  return {
    allowed: false,
    statusCode: 403,
    body: errorBody(
      'RESIDENCY_VIOLATION',
      `Request targets region '${requestedRegion}' but tenant data is pinned to '${pinnedRegion}'.`,
      { tenantId: tenant.tenantId, pinnedRegion, requestedRegion: requestedRegion ?? null }
    )
  };
}

export { getSupportedRegions, isSupportedRegion };
