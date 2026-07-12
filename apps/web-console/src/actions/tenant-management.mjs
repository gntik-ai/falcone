import {
  buildTenantPurgeRequestDraft,
  previewTenantFunctionalExport,
  previewTenantInventory,
  previewTenantLifecycleMutation,
  summarizeTenantManagementSurface
} from '../../../control-plane-executor/src/tenant-management.mjs';

export function buildTenantGovernanceCards({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  const surface = summarizeTenantManagementSurface({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });

  return [
    {
      id: 'tenant-lifecycle',
      title: 'Ciclo de vida',
      value: surface.dashboard.state,
      emphasis: surface.dashboard.governanceStatus,
      secondary: `Acciones permitidas: ${surface.dashboard.allowedActions.join(', ') || 'ninguna'}`
    },
    {
      id: 'tenant-quotas',
      title: 'Postura de cuotas',
      value: surface.dashboard.quotaAlerts.length === 0 ? 'nominal' : `${surface.dashboard.quotaAlerts.length} alerta(s)`,
      emphasis: surface.dashboard.quotaAlerts.some((alert) => alert.severity === 'blocked') ? 'blocked' : 'warning',
      secondary: `Retención: ${surface.dashboard.retentionDays ?? 'n/a'} días`
    },
    {
      id: 'tenant-inventory',
      title: 'Inventario',
      value: `${surface.dashboard.inventory.managedResourceCount} recursos`,
      secondary: `${surface.dashboard.inventory.workspaceCount} área(s) de trabajo, ${surface.dashboard.inventory.applicationCount} aplicación(es)`
    },
    {
      id: 'tenant-export',
      title: 'Export de recuperación',
      value: surface.dashboard.lastExportId ?? 'ninguno',
      secondary: surface.dashboard.deleteProtection ? 'Protección de borrado habilitada' : 'Protección de borrado deshabilitada'
    }
  ];
}

export function buildTenantInventoryRows({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  const inventory = previewTenantInventory({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });

  return inventory.workspaces.map((workspace) => ({
    workspaceId: workspace.workspaceId,
    workspaceSlug: workspace.workspaceSlug,
    environment: workspace.environment,
    state: workspace.state,
    managedResourceCount: workspace.managedResourceCount,
    applicationCount: workspace.applicationCount,
    serviceAccountCount: workspace.serviceAccountCount
  }));
}

export function buildTenantExportSummary({
  tenant,
  workspaces = [],
  externalApplications = [],
  serviceAccounts = [],
  managedResources = [],
  generatedAt
}) {
  return previewTenantFunctionalExport({
    tenant,
    workspaces,
    externalApplications,
    serviceAccounts,
    managedResources,
    generatedAt
  });
}

export function buildTenantActionChecklist({
  tenant,
  action,
  workspaces = [],
  managedResources = [],
  now,
  hasElevatedAccess,
  hasSecondConfirmation
}) {
  return previewTenantLifecycleMutation({
    tenant,
    action,
    workspaces,
    managedResources,
    now,
    hasElevatedAccess,
    hasSecondConfirmation
  });
}

export function buildTenantPurgeModalDefaults({ tenant, actorUserId = null, approvalTicket = '' }) {
  return buildTenantPurgeRequestDraft({ tenant, actorUserId, approvalTicket });
}
