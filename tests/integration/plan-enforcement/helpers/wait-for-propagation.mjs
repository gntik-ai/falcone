/**
 * Polling helper that waits for a value to converge after a state change.
 * Used to account for cache TTL and eventual consistency in the platform.
 */

import { env } from '../config/test-env.mjs';

/**
 * Poll `checkFn` until it returns `expectedValue` or the timeout expires.
 *
 * @param {() => Promise<any>} checkFn  Async function returning the current value.
 * @param {object} opts
 * @param {any} opts.expectedValue       Value to wait for (compared with ===, or deep-equal for objects).
 * @param {number} [opts.intervalMs]     Polling interval (default: PROPAGATION_POLL_MS).
 * @param {number} [opts.timeoutMs]      Max wait (default: PROPAGATION_TTL_MS).
 * @returns {Promise<{ converged: boolean, lastValue: any, elapsedMs: number }>}
 */
export async function waitForPropagation(checkFn, opts) {
  const intervalMs = opts.intervalMs ?? env.PROPAGATION_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? env.PROPAGATION_TTL_MS;
  const start = Date.now();
  let lastValue;

  while (Date.now() - start < timeoutMs) {
    lastValue = await checkFn();
    if (deepEqual(lastValue, opts.expectedValue)) {
      return { converged: true, lastValue, elapsedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  // Final attempt
  lastValue = await checkFn();
  if (deepEqual(lastValue, opts.expectedValue)) {
    return { converged: true, lastValue, elapsedMs: Date.now() - start };
  }

  throw new Error(
    `Propagation timeout (${timeoutMs}ms). Expected: ${JSON.stringify(opts.expectedValue)}, got: ${JSON.stringify(lastValue)}`,
  );
}

/**
 * Simple deep equality for primitives and plain objects/arrays.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => deepEqual(a[k], b[k]));
}
