export async function emitChangeImpactRecorded(producer, entry) {
  if (!producer?.send) return { skipped: true };
  const payload = {
    historyEntryId: entry.historyEntryId,
    planAssignmentId: entry.planAssignmentId,
    tenantId: entry.tenantId,
    previousPlanId: entry.previousPlanId ?? null,
    newPlanId: entry.newPlanId,
    actorId: entry.actorId,
    effectiveAt: entry.effectiveAt,
    correlationId: entry.correlationId ?? null,
    changeDirection: entry.changeDirection,
    usageCollectionStatus: entry.usageCollectionStatus,
    overLimitDimensionCount: entry.overLimitDimensionCount ?? 0,
    quotaDimensionCount: Array.isArray(entry.quotaImpacts) ? entry.quotaImpacts.length : 0,
    capabilityCount: Array.isArray(entry.capabilityImpacts) ? entry.capabilityImpacts.length : 0
  };
  await producer.send({
    topic: 'console.plan.change-impact-recorded',
    messages: [{ key: String(entry.historyEntryId), value: JSON.stringify(payload) }]
  });
  return payload;
}
