/**
 * Region guard shared by all provisioning appliers (feature
 * add-data-residency-pinning, #272).
 *
 * Appliers thread the tenant's pinned region as `options.regionRef`. When a
 * region is provided it MUST be in the platform's supported-regions catalog
 * (derived from deployment-topology.json). An unsupported region is refused
 * BEFORE any backend I/O: the applier throws {@link RegionNotSupportedError} and
 * creates no resource in any region.
 *
 * @module appliers/region-guard
 */

import { getSupportedRegions } from '../../../internal-contracts/src/deployment-topology.mjs';

/** Typed error for an applier targeting a region outside the supported catalog. */
export class RegionNotSupportedError extends Error {
  /**
   * @param {string} regionRef
   * @param {string[]} supportedRegions
   */
  constructor(regionRef, supportedRegions) {
    super(`Region '${regionRef}' is not in the supported-regions catalog (${supportedRegions.join(', ')}).`);
    this.name = 'RegionNotSupportedError';
    this.code = 'REGION_NOT_SUPPORTED';
    this.regionRef = regionRef;
    this.supportedRegions = supportedRegions;
  }
}

/**
 * Validate a `regionRef` against the supported-regions catalog.
 *
 * A null/undefined regionRef is a no-op (backward compatibility for callers that
 * do not pin a region). A provided regionRef that is not in the catalog throws.
 *
 * @param {string|null|undefined} regionRef
 * @param {object} [opts]
 * @param {string[]} [opts.supportedRegions] - injected catalog (defaults to the contract)
 * @returns {string|null} the validated region (or null when none was provided)
 * @throws {RegionNotSupportedError}
 */
export function assertRegionSupported(regionRef, { supportedRegions = getSupportedRegions() } = {}) {
  if (regionRef === null || regionRef === undefined) {
    return null;
  }
  if (!supportedRegions.includes(regionRef)) {
    throw new RegionNotSupportedError(regionRef, supportedRegions);
  }
  return regionRef;
}
