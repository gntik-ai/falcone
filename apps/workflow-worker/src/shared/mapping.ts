/**
 * DSL → Temporal mapping helpers.
 *
 * The field bindings here are VERBATIM from the normative contract
 * packages/internal-contracts/src/flow-definition-mapping.json (retryPolicyMapping):
 *
 *   maxAttempts            -> RetryPolicy.maximumAttempts
 *   backoffCoefficient     -> RetryPolicy.backoffCoefficient
 *   initialInterval        -> RetryPolicy.initialInterval
 *   maximumInterval        -> RetryPolicy.maximumInterval
 *   nonRetryableErrors     -> RetryPolicy.nonRetryableErrorTypes
 *   timeouts.startToClose  -> ActivityOptions.startToCloseTimeout
 *   timeouts.scheduleToClose -> ActivityOptions.scheduleToCloseTimeout
 *   timeouts.heartbeat     -> ActivityOptions.heartbeatTimeout
 *
 * This module is pure + deterministic (no host APIs), so it is safe to import inside
 * workflow code.
 */
import type { Duration } from '@temporalio/common';
import type { DslRetryPolicy } from './types';

/**
 * The DSL expresses every duration as an ISO-8601 duration string (FLW-E008), e.g. `PT2S`,
 * `PT30S`, `PT1M`, `P2D`. The Temporal SDK's `Duration` type does NOT accept ISO-8601 — it
 * wants a number of milliseconds or a `ms`-package string (`'2s'`). So we PARSE ISO-8601 to
 * milliseconds here. Pure + deterministic → safe inside workflow code.
 *
 * Supported grammar (matches the DSL's usage): an optional leading `P`, an optional date
 * part `nD` (days), and an optional time part `T` with `nH`/`nM`/`nS` (fractional seconds
 * allowed). Weeks (`nW`) are also supported. Months/years are intentionally NOT supported
 * (ambiguous calendar length; the DSL durations are sub-day to multi-day waits).
 */
const ISO_DURATION_RE =
  /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function isoDurationToMs(iso: string): number {
  const m = ISO_DURATION_RE.exec(iso.trim());
  if (!m || iso.trim() === 'P' || iso.trim() === 'PT') {
    throw new Error(`invalid ISO-8601 duration: '${iso}'`);
  }
  const [, w, d, h, min, s] = m;
  const weeks = w ? parseFloat(w) : 0;
  const days = d ? parseFloat(d) : 0;
  const hours = h ? parseFloat(h) : 0;
  const minutes = min ? parseFloat(min) : 0;
  const seconds = s ? parseFloat(s) : 0;
  return Math.round(
    ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000,
  );
}

/**
 * Convert a DSL ISO-8601 duration to a Temporal `Duration` (milliseconds number). The SDK
 * accepts a number of ms everywhere a `Duration` is expected.
 */
function asDuration(iso: string): Duration {
  return isoDurationToMs(iso) as unknown as Duration;
}

/** Subset of @temporalio RetryPolicy we populate from the DSL. */
export interface TemporalRetryPolicy {
  maximumAttempts?: number;
  backoffCoefficient?: number;
  initialInterval?: Duration;
  maximumInterval?: Duration;
  nonRetryableErrorTypes?: string[];
}

/** Subset of @temporalio ActivityOptions timeouts we populate from the DSL. */
export interface TemporalActivityTimeouts {
  startToCloseTimeout?: Duration;
  scheduleToCloseTimeout?: Duration;
  heartbeatTimeout?: Duration;
}

/**
 * Map a DSL retryPolicy to a Temporal RetryPolicy applied VERBATIM — only fields the
 * DSL actually specifies are set, so an unspecified policy leaves the SDK defaults in
 * place (spec: "Task with no retry policy" → SDK default retry policy).
 */
export function mapRetryPolicy(dsl?: DslRetryPolicy): TemporalRetryPolicy | undefined {
  if (!dsl) return undefined;
  const out: TemporalRetryPolicy = {};
  if (dsl.maxAttempts !== undefined) out.maximumAttempts = dsl.maxAttempts;
  if (dsl.backoffCoefficient !== undefined) out.backoffCoefficient = dsl.backoffCoefficient;
  if (dsl.initialInterval !== undefined) out.initialInterval = asDuration(dsl.initialInterval);
  if (dsl.maximumInterval !== undefined) out.maximumInterval = asDuration(dsl.maximumInterval);
  if (dsl.nonRetryableErrors !== undefined) out.nonRetryableErrorTypes = dsl.nonRetryableErrors;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Map DSL retryPolicy.timeouts to Temporal ActivityOptions timeout fields. */
export function mapActivityTimeouts(dsl?: DslRetryPolicy): TemporalActivityTimeouts {
  const t = dsl?.timeouts;
  const out: TemporalActivityTimeouts = {};
  if (t?.startToClose !== undefined) out.startToCloseTimeout = asDuration(t.startToClose);
  if (t?.scheduleToClose !== undefined) out.scheduleToCloseTimeout = asDuration(t.scheduleToClose);
  if (t?.heartbeat !== undefined) out.heartbeatTimeout = asDuration(t.heartbeat);
  return out;
}
