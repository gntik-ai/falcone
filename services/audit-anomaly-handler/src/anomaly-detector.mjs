/**
 * Per-tenant sliding-window anomaly detector.
 *
 * PURE and deterministic: every call to {@link recordEvent} takes an explicit
 * `now` (epoch milliseconds). The detector never reads the wall clock, so tests
 * fully control both the detection window and the suppression window.
 *
 * State is keyed by `(tenant_id, alert_type)`:
 *   - a sliding window of event timestamps (older than `alertWindowSeconds`
 *     are evicted before each evaluation), and
 *   - the timestamp of the last emitted alert, used to suppress duplicate
 *     alerts within the suppression window.
 */
import { getRulesConfig } from './rules.mjs';
import { getAlertSuppressionDefaults } from '../../internal-contracts/src/index.mjs';

// Map audit event types -> { alertType, thresholdKey }.
const EVENT_RULES = Object.freeze({
  cross_tenant_violation: {
    alertType: 'cross_tenant_violation_burst',
    thresholdKey: 'crossTenantViolationThreshold'
  },
  capability_enforcement_denied: {
    alertType: 'capability_denial_burst',
    thresholdKey: 'capabilityDenialThreshold'
  }
});

// Fallback suppression window when the alert contract does not expose a numeric
// `default_suppression_window_seconds`. The contract's `getAlertSuppressionDefaults`
// describes dedupe semantics but does not always carry a window length, so we
// honor it when present and otherwise reuse the detection window length.
const FALLBACK_SUPPRESSION_WINDOW_SECONDS = 300;

function resolveSuppressionWindowSeconds(alertWindowSeconds) {
  const defaults = getAlertSuppressionDefaults() ?? {};
  const fromContract = Number(defaults.default_suppression_window_seconds);
  if (Number.isFinite(fromContract) && fromContract > 0) {
    return fromContract;
  }
  // Suppression must be at least as long as the detection window so a single
  // logical burst cannot re-alert as its tail keeps arriving.
  return Math.max(alertWindowSeconds, FALLBACK_SUPPRESSION_WINDOW_SECONDS);
}

function eventTenantId(event) {
  return event?.tenantId ?? event?.tenant_id ?? null;
}

function eventCorrelationId(event) {
  return event?.correlationId ?? event?.correlation_id ?? null;
}

/**
 * Create a stateful detector.
 *
 * @param {object} [options]
 * @param {Record<string,string|undefined>} [options.env] env for rule config
 * @param {number} [options.suppressionWindowSeconds] override suppression window
 * @returns {{ recordEvent: (event: object, now: number) => (object|null) }}
 */
export function createAnomalyDetector(options = {}) {
  const config = getRulesConfig(options.env);
  const windowMs = config.alertWindowSeconds * 1000;
  const suppressionWindowSeconds =
    options.suppressionWindowSeconds ?? resolveSuppressionWindowSeconds(config.alertWindowSeconds);
  const suppressionMs = suppressionWindowSeconds * 1000;

  // key -> { events: [{ ts, correlationId }], lastAlertAt: number|null }
  const state = new Map();

  function stateFor(key) {
    let entry = state.get(key);
    if (!entry) {
      entry = { events: [], lastAlertAt: null };
      state.set(key, entry);
    }
    return entry;
  }

  function recordEvent(event, now) {
    const rule = EVENT_RULES[event?.eventType];
    const tenantId = eventTenantId(event);
    if (!rule || !tenantId || typeof now !== 'number') {
      return null;
    }

    const threshold = config[rule.thresholdKey];
    const key = `${tenantId}::${rule.alertType}`;
    const entry = stateFor(key);

    // Evict timestamps that fell out of the sliding window.
    const cutoff = now - windowMs;
    entry.events = entry.events.filter((e) => e.ts > cutoff);
    entry.events.push({ ts: now, correlationId: eventCorrelationId(event) });

    if (entry.events.length < threshold) {
      return null;
    }

    // Suppression: do not re-alert for the same (tenant, alert_type) while a
    // prior alert is still inside the suppression window.
    if (entry.lastAlertAt !== null && now - entry.lastAlertAt < suppressionMs) {
      return null;
    }

    entry.lastAlertAt = now;

    const firstTs = entry.events[0].ts;
    const lastTs = entry.events[entry.events.length - 1].ts;
    const correlationId =
      entry.events[entry.events.length - 1].correlationId ?? entry.events[0].correlationId ?? null;

    return {
      tenant_id: tenantId,
      alert_type: rule.alertType,
      event_count: entry.events.length,
      window_seconds: config.alertWindowSeconds,
      first_event_at: new Date(firstTs).toISOString(),
      last_event_at: new Date(lastTs).toISOString(),
      correlation_id: correlationId
    };
  }

  return { recordEvent };
}
