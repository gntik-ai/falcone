import { UNLIMITED_SENTINEL, isUnlimited } from './quota-dimension.mjs';
import { normalizeQuotaType } from './quota-override.mjs';

export function normalizeEffectiveLimit(entry = {}) {
  const effectiveLimit = Number(entry.effectiveValue ?? entry.effectiveLimit ?? UNLIMITED_SENTINEL);
  const graceMargin = Number(entry.graceMargin ?? 0);
  const quotaType = normalizeQuotaType(entry.quotaType);
  return {
    ...entry,
    effectiveLimit,
    quotaType,
    graceMargin,
    effectiveCeiling: isUnlimited(effectiveLimit) ? UNLIMITED_SENTINEL : effectiveLimit + (quotaType === 'soft' ? graceMargin : 0),
    unlimitedSentinel: isUnlimited(effectiveLimit)
  };
}

export function evaluateQuotaDecision({ effectiveLimit, quotaType = 'hard', graceMargin = 0, currentUsage } = {}) {
  if (currentUsage === undefined || currentUsage === null || Number.isNaN(Number(currentUsage))) {
    return { allowed: false, decision: 'metering_unavailable', errorCode: 'METERING_UNAVAILABLE' };
  }
  const normalized = normalizeEffectiveLimit({ effectiveLimit, quotaType, graceMargin });
  const usage = Number(currentUsage);
  if (normalized.unlimitedSentinel) {
    return { allowed: true, decision: 'unlimited', currentUsage: usage, ...normalized };
  }
  if (normalized.quotaType === 'hard') {
    return usage >= normalized.effectiveLimit
      ? { allowed: false, decision: 'hard_blocked', currentUsage: usage, ...normalized }
      : { allowed: true, decision: 'allowed', currentUsage: usage, ...normalized };
  }
  if (usage >= normalized.effectiveCeiling) {
    return { allowed: false, decision: 'soft_grace_exhausted', currentUsage: usage, ...normalized };
  }
  if (usage >= normalized.effectiveLimit) {
    return {
      allowed: true,
      decision: 'soft_grace_allowed',
      currentUsage: usage,
      warning: `Soft quota exceeded. Usage ${usage}/${normalized.effectiveLimit} (grace ceiling: ${normalized.effectiveCeiling}).`,
      ...normalized
    };
  }
  return { allowed: true, decision: 'allowed', currentUsage: usage, ...normalized };
}
