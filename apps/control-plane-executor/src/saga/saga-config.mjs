const intFromEnv = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const SAGA_CONFIG = {
  compensation: {
    maxRetries: intFromEnv('SAGA_COMPENSATION_MAX_RETRIES', 3),
    baseDelayMs: intFromEnv('SAGA_COMPENSATION_BASE_DELAY_MS', 500),
    backoffMultiplier: 2.0,
    maxDelayMs: intFromEnv('SAGA_COMPENSATION_MAX_DELAY_MS', 10_000)
  },
  recovery: {
    staleness_threshold_ms: intFromEnv('SAGA_RECOVERY_STALENESS_MS', 60_000),
    default_policy: 'compensate'
  },
  idempotency: {
    ttl_ms: 86_400_000
  }
};
