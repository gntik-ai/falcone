import {
  filterPublicRoutes,
  getApiFamily,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  STORAGE_PROVIDER_ERROR_CODES,
  STORAGE_PROVIDER_CAPABILITY_FIELDS,
  buildStorageProviderProfile,
  listSupportedStorageProviders,
  summarizeStorageProviderCompatibility
} from '../../../services/adapters/src/storage-provider-profile.mjs';
import {
  TENANT_STORAGE_CONTEXT_ERROR_CODES,
  buildTenantStorageContextIntrospection,
  buildTenantStorageContextRecord,
  buildTenantStorageProvisioningEvent,
  previewWorkspaceStorageBootstrap,
  rotateTenantStorageContextCredential
} from '../../../services/adapters/src/storage-tenant-context.mjs';

export const storageApiFamily = getApiFamily('storage');
export const STORAGE_ADMIN_ERROR_CODES = STORAGE_PROVIDER_ERROR_CODES;
export const TENANT_STORAGE_ERROR_CODES = TENANT_STORAGE_CONTEXT_ERROR_CODES;
export const STORAGE_PROVIDER_CAPABILITIES = STORAGE_PROVIDER_CAPABILITY_FIELDS;

function matchesRouteFilters(route, filters = {}) {
  return Object.entries(filters).every(([key, value]) => route?.[key] === value);
}

export function listStorageAdminRoutes(filters = {}) {
  const storageRoutes = filterPublicRoutes({ family: 'storage' });
  const providerRoute = getPublicRoute('getStorageProviderIntrospection');
  const tenantContextRoute = getPublicRoute('getTenantStorageContext');
  const tenantRotationRoute = getPublicRoute('rotateTenantStorageContextCredential');
  const combinedRoutes = [
    ...storageRoutes,
    providerRoute,
    tenantContextRoute,
    tenantRotationRoute
  ].filter(Boolean);

  return combinedRoutes.filter((route) => matchesRouteFilters(route, filters));
}

export const storageAdminRoutes = listStorageAdminRoutes();

export function getStorageAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route && (route.family === 'storage' || ['storage_provider', 'tenant_storage_context'].includes(route.resourceType))
    ? route
    : undefined;
}

export function summarizeStorageProviderSupport(input = {}) {
  return buildStorageProviderProfile(input);
}

export function summarizeStorageProviderIntrospection(input = {}) {
  const route = getStorageAdminRoute('getStorageProviderIntrospection');
  const profile = summarizeStorageProviderSupport(input);

  return {
    route,
    profile,
    supportedProviders: listSupportedStorageProviders(),
    capabilityFields: [...STORAGE_PROVIDER_CAPABILITY_FIELDS]
  };
}

export function getStorageCompatibilitySummary(input = {}) {
  const compatibility = summarizeStorageProviderCompatibility(input);
  const providerRoute = getStorageAdminRoute('getStorageProviderIntrospection');

  return {
    ...compatibility,
    routeIds: providerRoute ? [providerRoute.operationId] : [],
    publicBucketRoutes: storageAdminRoutes
      .filter((route) => route.resourceType === 'bucket')
      .map((route) => route.operationId)
  };
}

export function previewTenantStorageContext(input = {}) {
  return buildTenantStorageContextRecord(input);
}

export function summarizeTenantStorageContext(input = {}) {
  const context = previewTenantStorageContext(input);
  const route = getStorageAdminRoute('getTenantStorageContext');

  return {
    route,
    context: buildTenantStorageContextIntrospection(context)
  };
}

export function rotateTenantStorageCredentialPreview(input = {}) {
  const rotatedContext = rotateTenantStorageContextCredential(input);
  const route = getStorageAdminRoute('rotateTenantStorageContextCredential');

  return {
    route,
    context: buildTenantStorageContextIntrospection(rotatedContext)
  };
}

export function buildTenantStorageEvent(input = {}) {
  return buildTenantStorageProvisioningEvent(input);
}

export function previewWorkspaceStorageBootstrapContext(input = {}) {
  return previewWorkspaceStorageBootstrap(input);
}
