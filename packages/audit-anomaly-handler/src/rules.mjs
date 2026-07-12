/**
 * Anomaly-detection rule configuration.
 *
 * Thresholds and the sliding-window length are read from the environment so
 * operators can tune detection per deployment. This module is a PURE config
 * getter — it does not perform detection and has no Kafka dependency.
 */

const DEFAULTS = Object.freeze({
  crossTenantViolationThreshold: 5,
  capabilityDenialThreshold: 10,
  alertWindowSeconds: 60
});

function readPositiveInt(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Resolve the active rule configuration from the supplied environment.
 *
 * @param {Record<string, string|undefined>} [env] defaults to process.env
 * @returns {{
 *   crossTenantViolationThreshold: number,
 *   capabilityDenialThreshold: number,
 *   alertWindowSeconds: number
 * }}
 */
export function getRulesConfig(env = process.env) {
  return {
    crossTenantViolationThreshold: readPositiveInt(
      env.CROSS_TENANT_VIOLATION_THRESHOLD_COUNT,
      DEFAULTS.crossTenantViolationThreshold
    ),
    capabilityDenialThreshold: readPositiveInt(
      env.CAPABILITY_DENIAL_THRESHOLD_COUNT,
      DEFAULTS.capabilityDenialThreshold
    ),
    alertWindowSeconds: readPositiveInt(
      env.ALERT_WINDOW_SECONDS,
      DEFAULTS.alertWindowSeconds
    )
  };
}

export const RULE_DEFAULTS = DEFAULTS;
