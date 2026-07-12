/**
 * Deployment-topology helpers.
 *
 * `deployment-topology.json` is the authoritative source of deployed topology.
 * It is plain JSON and cannot export functions, so this sibling module reads it
 * and derives runtime helpers from it (feature add-data-residency-pinning, #272).
 *
 * The supported-regions catalog is the distinct set of `topology.region_ref`
 * values across all environment profiles. A top-level `supported_regions` array
 * is also written into the JSON for direct, dependency-free consumption; this
 * helper prefers that array and falls back to deriving it from the profiles so
 * the two never drift.
 *
 * @module deployment-topology
 */

import { readFileSync } from 'node:fs';

const DEPLOYMENT_TOPOLOGY_URL = new URL('./deployment-topology.json', import.meta.url);

let cached;

function readTopology() {
  if (!cached) {
    cached = JSON.parse(readFileSync(DEPLOYMENT_TOPOLOGY_URL, 'utf8'));
  }
  return cached;
}

/**
 * Distinct `region_ref` values declared across the environment profiles, in
 * first-seen order.
 *
 * @param {object} [topology] - injected topology document (defaults to the contract file)
 * @returns {string[]}
 */
export function deriveSupportedRegions(topology = readTopology()) {
  const seen = [];
  for (const profile of topology?.environment_profiles ?? []) {
    const region = profile?.topology?.region_ref;
    if (typeof region === 'string' && region.length > 0 && !seen.includes(region)) {
      seen.push(region);
    }
  }
  return seen;
}

/**
 * The platform's supported-regions catalog: valid values for a tenant's
 * `dataResidency.region` at provisioning time.
 *
 * Prefers the explicit top-level `supported_regions` array in the contract;
 * falls back to deriving from the environment profiles.
 *
 * @returns {string[]}
 */
export function getSupportedRegions() {
  const topology = readTopology();
  if (Array.isArray(topology?.supported_regions) && topology.supported_regions.length > 0) {
    return [...topology.supported_regions];
  }
  return deriveSupportedRegions(topology);
}

/**
 * Whether a region identifier is in the supported-regions catalog.
 *
 * @param {string} region
 * @param {string[]} [supportedRegions]
 * @returns {boolean}
 */
export function isSupportedRegion(region, supportedRegions = getSupportedRegions()) {
  return supportedRegions.includes(region);
}
