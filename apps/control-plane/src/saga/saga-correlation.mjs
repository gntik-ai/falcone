const random8 = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0').slice(0, 8);

export function buildCorrelationId(workflowId, callerContext = {}) {
  return `saga:${workflowId}:${callerContext.tenantId ?? 'unknown'}:${Date.now().toString(36)}:${random8()}`;
}

export function enrichContextWithCorrelation(sagaCtx = {}, existingCorrelationId) {
  return {
    ...sagaCtx,
    correlationId: existingCorrelationId
      ? `${existingCorrelationId}::saga:${sagaCtx.workflowId}:${random8()}`
      : buildCorrelationId(sagaCtx.workflowId, sagaCtx)
  };
}
