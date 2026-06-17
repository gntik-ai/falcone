// Retry-with-exponential-backoff for the control-plane boot schema/recovery
// (fix-control-plane-schema-migration-retry, finding D5).
//
// Postgres is frequently not yet accepting connections when the control-plane starts
// (rolling restart / fresh install). The boot path previously ran ensureSchema ->
// ensureSagaSchema -> recoverSagas exactly once and only logged on failure, so a startup
// ECONNREFUSED left the `tenants`/saga tables uncreated and every tenant op 500'd
// ("relation \"tenants\" does not exist") until a manual pod restart.
//
// runWithRetry keeps retrying the boot task with exponential backoff until it succeeds or a
// max duration elapses, then rethrows so the caller can exit non-zero (the pod restarts and
// tries again). now()/sleep() are injectable so the behaviour is unit-testable without real
// timers or a database.

/** Resolve retry tuning from the environment (all overridable). */
export function migrationRetryConfig(env = process.env) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return {
    timeoutMs: num(env.SCHEMA_MIGRATION_TIMEOUT_MS, 300_000), // keep retrying for 5 min
    initialDelayMs: num(env.SCHEMA_MIGRATION_INITIAL_DELAY_MS, 1_000), // first backoff 1 s
    maxDelayMs: num(env.SCHEMA_MIGRATION_MAX_DELAY_MS, 30_000), // cap backoff at 30 s
  };
}

/**
 * Run `task(attempt)` with exponential backoff until it resolves or the timeout elapses.
 * Resolves with the task's return value; rejects with the last error once the deadline passes.
 *
 * @param {(attempt:number)=>Promise<any>} task
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]     total time budget before giving up
 * @param {number} [opts.initialDelayMs] backoff before the 2nd attempt
 * @param {number} [opts.maxDelayMs]     backoff ceiling
 * @param {()=>number} [opts.now]        clock (ms); injectable for tests
 * @param {(ms:number)=>Promise<void>} [opts.sleep] delay fn; injectable for tests
 * @param {{log:Function,error:Function}} [opts.log] logger
 */
export async function runWithRetry(task, opts = {}) {
  const {
    timeoutMs = 300_000,
    initialDelayMs = 1_000,
    maxDelayMs = 30_000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = console,
  } = opts;

  const deadline = now() + timeoutMs;
  let attempt = 0;
  let delay = initialDelayMs;

  for (;;) {
    attempt += 1;
    try {
      return await task(attempt);
    } catch (err) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        log.error(
          `[control-plane] schema/recovery failed after ${attempt} attempt(s); giving up: ${err?.message ?? err}`,
        );
        throw err;
      }
      // never sleep past the deadline
      const wait = Math.max(0, Math.min(delay, maxDelayMs, remaining));
      log.error(
        `[control-plane] schema/recovery attempt ${attempt} failed: ${err?.message ?? err}; retrying in ${wait}ms`,
      );
      await sleep(wait);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}
