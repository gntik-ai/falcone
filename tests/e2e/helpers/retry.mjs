/**
 * Retry helper with exponential backoff and sleep utility.
 * @module tests/e2e/helpers/retry
 */

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, delayMs?: number }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export async function withRetry(fn, { maxAttempts = 3, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(delayMs * Math.pow(2, attempt - 1));
      }
    }
  }
  throw lastError;
}
