const VALUE_KINDS = new Set(['bounded', 'unlimited', 'missing']);
const QUOTA_COMPARISONS = new Set(['increased', 'decreased', 'unchanged', 'added', 'removed']);
const CAPABILITY_COMPARISONS = new Set(['enabled', 'disabled', 'unchanged']);
const USAGE_STATUSES = new Set(['within_limit', 'at_limit', 'over_limit', 'unknown']);

export function normalizeEffectiveValue(value) {
  if (value === undefined) return { effectiveValueKind: 'missing', effectiveValue: null };
  if (value === null) return { effectiveValueKind: 'missing', effectiveValue: null };
  if (value === -1 || value === 'unlimited') return { effectiveValueKind: 'unlimited', effectiveValue: null };
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { effectiveValueKind: 'missing', effectiveValue: null };
  return { effectiveValueKind: 'bounded', effectiveValue: Math.trunc(numeric) };
}

function comparableMagnitude(kind, value) {
  if (kind === 'unlimited') return Number.POSITIVE_INFINITY;
  if (kind === 'missing') return Number.NEGATIVE_INFINITY;
  return Number(value ?? 0);
}

export function classifyQuotaDiff(previousValue, nextValue) {
  const previous = previousValue?.effectiveValueKind ? previousValue : normalizeEffectiveValue(previousValue);
  const next = nextValue?.effectiveValueKind ? nextValue : normalizeEffectiveValue(nextValue);
  if (previous.effectiveValueKind === 'missing' && next.effectiveValueKind !== 'missing') return 'added';
  if (previous.effectiveValueKind !== 'missing' && next.effectiveValueKind === 'missing') return 'removed';
  const previousMagnitude = comparableMagnitude(previous.effectiveValueKind, previous.effectiveValue);
  const nextMagnitude = comparableMagnitude(next.effectiveValueKind, next.effectiveValue);
  if (previousMagnitude === nextMagnitude) return 'unchanged';
  return nextMagnitude > previousMagnitude ? 'increased' : 'decreased';
}

export function classifyCapabilityDiff(previousState, nextState) {
  if (Boolean(previousState) === Boolean(nextState)) return 'unchanged';
  return Boolean(nextState) ? 'enabled' : 'disabled';
}

export function classifyUsageStatus({ newEffectiveValueKind, newEffectiveValue, observedUsage }) {
  if (observedUsage === null || observedUsage === undefined) return 'unknown';
  if (newEffectiveValueKind === 'unlimited') return 'within_limit';
  if (newEffectiveValueKind === 'missing') return 'unknown';
  if (observedUsage > newEffectiveValue) return 'over_limit';
  if (observedUsage === newEffectiveValue) return 'at_limit';
  return 'within_limit';
}

export function buildQuotaImpact(previousDimension = {}, nextDimension = {}, usage = {}) {
  const previous = previousDimension.effectiveValueKind ? previousDimension : { ...previousDimension, ...normalizeEffectiveValue(previousDimension.effectiveValue ?? previousDimension.value) };
  const next = nextDimension.effectiveValueKind ? nextDimension : { ...nextDimension, ...normalizeEffectiveValue(nextDimension.effectiveValue ?? nextDimension.value) };
  const comparison = classifyQuotaDiff(previous, next);
  const usageStatus = usage.status === 'unknown'
    ? 'unknown'
    : classifyUsageStatus({ newEffectiveValueKind: next.effectiveValueKind, newEffectiveValue: next.effectiveValue, observedUsage: usage.observedUsage });
  return {
    dimensionKey: next.dimensionKey ?? previous.dimensionKey,
    displayLabel: next.displayLabel ?? previous.displayLabel ?? next.dimensionKey ?? previous.dimensionKey,
    unit: next.unit ?? previous.unit ?? null,
    previousEffectiveValueKind: previous.effectiveValueKind,
    previousEffectiveValue: previous.effectiveValue ?? null,
    newEffectiveValueKind: next.effectiveValueKind,
    newEffectiveValue: next.effectiveValue ?? null,
    comparison,
    observedUsage: usage.status === 'unknown' ? null : (usage.observedUsage ?? null),
    usageObservedAt: usage.usageObservedAt ?? null,
    usageSource: usage.usageSource ?? null,
    usageStatus,
    usageUnknownReason: usage.status === 'unknown' ? (usage.reasonCode ?? 'usage_source_unavailable') : null,
    isHardDecrease: comparison === 'decreased' && usageStatus === 'over_limit'
  };
}

export function buildCapabilityImpact(previousCapability = {}, nextCapability = {}) {
  const previousState = previousCapability.enabled;
  const nextState = nextCapability.enabled;
  return {
    capabilityKey: nextCapability.capabilityKey ?? previousCapability.capabilityKey,
    displayLabel: nextCapability.displayLabel ?? previousCapability.displayLabel ?? nextCapability.capabilityKey ?? previousCapability.capabilityKey,
    previousState: previousState ?? null,
    newState: nextState ?? null,
    comparison: classifyCapabilityDiff(previousState, nextState)
  };
}

export function buildQuotaImpactSet(previousDimensions = [], nextDimensions = [], usages = []) {
  const previousMap = new Map(previousDimensions.map((item) => [item.dimensionKey, item]));
  const nextMap = new Map(nextDimensions.map((item) => [item.dimensionKey, item]));
  const usageMap = new Map(usages.map((item) => [item.dimensionKey, item]));
  const keys = [...new Set([...previousMap.keys(), ...nextMap.keys()])].sort();
  return keys.map((dimensionKey) => buildQuotaImpact(previousMap.get(dimensionKey), { dimensionKey, ...nextMap.get(dimensionKey) }, usageMap.get(dimensionKey) ?? { dimensionKey, status: 'unknown', reasonCode: 'usage_not_collected' }));
}

export function buildCapabilityImpactSet(previousCapabilities = [], nextCapabilities = []) {
  const previousMap = new Map(previousCapabilities.map((item) => [item.capabilityKey, item]));
  const nextMap = new Map(nextCapabilities.map((item) => [item.capabilityKey, item]));
  const keys = [...new Set([...previousMap.keys(), ...nextMap.keys()])].sort();
  return keys.map((capabilityKey) => buildCapabilityImpact(previousMap.get(capabilityKey), { capabilityKey, ...nextMap.get(capabilityKey) }));
}

export function determineChangeDirection(previousDimensions = [], nextDimensions = [], previousPlanId, newPlanId) {
  if (!previousPlanId) return 'initial_assignment';
  const impacts = buildQuotaImpactSet(previousDimensions, nextDimensions, []);
  const hasIncrease = impacts.some((item) => item.comparison === 'increased' || item.comparison === 'added');
  const hasDecrease = impacts.some((item) => item.comparison === 'decreased' || item.comparison === 'removed');
  if (hasIncrease && !hasDecrease) return 'upgrade';
  if (hasDecrease && !hasIncrease) return 'downgrade';
  if (!hasIncrease && !hasDecrease && previousPlanId === newPlanId) return 'equivalent';
  return hasIncrease || hasDecrease ? 'lateral' : 'equivalent';
}

export function summarizeUsageCollectionStatus(usages = []) {
  if (!usages.length) return 'unavailable';
  const known = usages.filter((item) => item.status !== 'unknown').length;
  if (known === 0) return 'unavailable';
  if (known === usages.length) return 'complete';
  return 'partial';
}

export function validateImpactKinds(item = {}) {
  if (item.previousEffectiveValueKind && !VALUE_KINDS.has(item.previousEffectiveValueKind)) throw new Error(`Unsupported previousEffectiveValueKind: ${item.previousEffectiveValueKind}`);
  if (item.newEffectiveValueKind && !VALUE_KINDS.has(item.newEffectiveValueKind)) throw new Error(`Unsupported newEffectiveValueKind: ${item.newEffectiveValueKind}`);
  if (item.comparison && !QUOTA_COMPARISONS.has(item.comparison) && !CAPABILITY_COMPARISONS.has(item.comparison)) throw new Error(`Unsupported comparison: ${item.comparison}`);
  if (item.usageStatus && !USAGE_STATUSES.has(item.usageStatus)) throw new Error(`Unsupported usageStatus: ${item.usageStatus}`);
  return true;
}
