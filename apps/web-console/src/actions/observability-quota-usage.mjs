function countByPosture(dimensions = [], posture) {
  return dimensions.filter((dimension) => dimension.posture === posture).length;
}

function headlineForOverview(overview = {}) {
  if ((overview.hardLimitDimensions ?? []).length > 0) {
    return `${overview.hardLimitDimensions.length} incumplimiento(s) de límite estricto`;
  }
  if ((overview.softLimitDimensions ?? []).length > 0) {
    return `${overview.softLimitDimensions.length} incumplimiento(s) de límite suave`;
  }
  if ((overview.warningDimensions ?? []).length > 0) {
    return `${overview.warningDimensions.length} dimensión(es) en advertencia`;
  }
  return 'Dentro de los límites';
}

function emphasisForOverview(overview = {}) {
  switch (overview.overallPosture) {
    case 'hard_limit_reached':
      return 'critical';
    case 'soft_limit_exceeded':
      return 'elevated';
    case 'warning_threshold_reached':
      return 'warning';
    case 'evidence_degraded':
    case 'evidence_unavailable':
      return 'degraded';
    default:
      return 'healthy';
  }
}

export function buildTenantQuotaUsageCards(overview = {}) {
  const dimensions = overview.dimensions ?? [];
  return [
    {
      id: 'tenant-overview-status',
      title: 'Postura de cuotas',
      value: headlineForOverview(overview),
      emphasis: emphasisForOverview(overview),
      secondary: `Políticas configuradas: ${overview.policiesConfigured ? 'sí' : 'no'}`
    },
    {
      id: 'tenant-overview-warning-count',
      title: 'Advertencias',
      value: `${countByPosture(dimensions, 'warning_threshold_reached')} dimensión(es)`,
      emphasis: (overview.warningDimensions ?? []).length > 0 ? 'warning' : 'healthy',
      secondary: `${countByPosture(dimensions, 'evidence_degraded') + countByPosture(dimensions, 'evidence_unavailable')} dimensión(es) degradadas`
    },
    {
      id: 'tenant-overview-capacity',
      title: 'Presión de capacidad',
      value: `${(overview.softLimitDimensions ?? []).length} suave / ${(overview.hardLimitDimensions ?? []).length} estricto`,
      emphasis: (overview.hardLimitDimensions ?? []).length > 0 ? 'critical' : (overview.softLimitDimensions ?? []).length > 0 ? 'elevated' : 'healthy',
      secondary: `Generado en ${overview.generatedAt ?? 'n/a'}`
    }
  ];
}

export function buildTenantProvisioningBanner(overview = {}) {
  const provisioning = overview.provisioningState ?? {};
  return {
    id: 'tenant-provisioning-banner',
    title: 'Estado de aprovisionamiento',
    value: provisioning.state ?? 'Desconocido',
    emphasis: provisioning.visualState ?? 'unknown',
    secondary: provisioning.reasonSummary ?? 'No hay resumen de provisioning disponible.',
    degradedComponents: provisioning.degradedComponents ?? []
  };
}

export function buildQuotaUsageTableRows(overview = {}) {
  return (overview.dimensions ?? []).map((dimension) => ({
    dimensionId: dimension.dimensionId,
    label: dimension.displayName,
    usage: dimension.currentUsage,
    unit: dimension.unit,
    warningThreshold: dimension.warningThreshold,
    softLimit: dimension.softLimit,
    hardLimit: dimension.hardLimit,
    usagePercentage: dimension.usagePercentage,
    posture: dimension.posture,
    visualState: dimension.visualState,
    freshnessStatus: dimension.freshnessStatus,
    blockingState: dimension.blockingState,
    lastUpdatedAt: dimension.lastUpdatedAt
  }));
}

export function buildWorkspaceQuotaUsageRows(overview = {}) {
  return buildQuotaUsageTableRows(overview).map((row) => ({
    workspaceId: overview.workspaceId,
    ...row
  }));
}
