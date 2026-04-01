/**
 * Conservative comparison helpers for reprovision appliers.
 * @module reprovision/diff
 */

import { REDACTED_MARKER } from './types.mjs';

/**
 * Deep-compare two JSON values, ignoring specified keys.
 * @param {unknown} existing - current state in the subsystem
 * @param {unknown} desired  - desired state from the artifact
 * @param {string[]} [ignoreKeys] - keys to exclude from comparison
 * @returns {'equal' | 'different'}
 */
export function compareResources(existing, desired, ignoreKeys = []) {
  const ignoreSet = new Set(ignoreKeys);
  return _deepCompare(existing, desired, ignoreSet) ? 'equal' : 'different';
}

function _deepCompare(a, b, ignoreSet) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return a === b;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!_deepCompare(a[i], b[i], ignoreSet)) return false;
    }
    return true;
  }

  const keysA = Object.keys(a).filter(k => !ignoreSet.has(k));
  const keysB = Object.keys(b).filter(k => !ignoreSet.has(k));
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!_deepCompare(a[key], b[key], ignoreSet)) return false;
  }
  return true;
}

/**
 * Resolve the action for a resource based on existence and comparison.
 *
 * @param {boolean} existsInTarget
 * @param {'equal'|'different'} comparison
 * @param {boolean} [dryRun]
 * @returns {import('./types.mjs').ResourceAction}
 */
export function resolveAction(existsInTarget, comparison, dryRun = false) {
  if (!existsInTarget) return dryRun ? 'would_create' : 'created';
  if (comparison === 'equal') return dryRun ? 'would_skip' : 'skipped';
  return dryRun ? 'would_conflict' : 'conflict';
}

/**
 * Generate a human-readable diff between two objects.
 * Only includes keys that differ. Redacted values are masked.
 *
 * @param {Object} existing
 * @param {Object} desired
 * @returns {Object | null} - null if no differences
 */
export function buildDiff(existing, desired) {
  if (!existing || !desired) return null;
  if (typeof existing !== 'object' || typeof desired !== 'object') return null;

  const diff = {};
  const allKeys = new Set([...Object.keys(existing), ...Object.keys(desired)]);

  for (const key of allKeys) {
    const a = existing[key];
    const b = desired[key];
    if (!_deepCompare(a, b, new Set())) {
      diff[key] = {
        existing: _maskRedacted(a),
        desired: _maskRedacted(b),
      };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

function _maskRedacted(val) {
  if (val === REDACTED_MARKER) return REDACTED_MARKER;
  if (typeof val === 'string') return val;
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;

  if (Array.isArray(val)) return val.map(_maskRedacted);

  const out = {};
  for (const [k, v] of Object.entries(val)) {
    out[k] = _maskRedacted(v);
  }
  return out;
}
