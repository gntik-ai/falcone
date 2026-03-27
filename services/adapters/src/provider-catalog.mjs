import {
  getContract,
  listAdapterPorts,
  listAdapterPortsForConsumer
} from '../../internal-contracts/src/index.mjs';
import {
  SUPPORTED_STORAGE_PROVIDER_TYPES,
  buildStorageProviderProfile,
  listSupportedStorageProviders,
  summarizeStorageProviderCompatibility
} from './storage-provider-profile.mjs';
import {
  buildTenantStorageContextIntrospection,
  buildTenantStorageContextRecord,
  buildTenantStorageProvisioningEvent,
  previewWorkspaceStorageBootstrap,
  rotateTenantStorageContextCredential
} from './storage-tenant-context.mjs';

export const providerAdapterCatalog = listAdapterPorts();
export const adapterCallContract = getContract('adapter_call');
export const adapterResultContract = getContract('adapter_result');
export const supportedStorageProviderTypes = SUPPORTED_STORAGE_PROVIDER_TYPES;

export function listProvisioningAdapters() {
  return listAdapterPortsForConsumer('provisioning_orchestrator');
}

export function listAuditAdapters() {
  return listAdapterPortsForConsumer('audit_module');
}

export function listStorageProviderProfiles() {
  return listSupportedStorageProviders();
}

export function getStorageProviderProfile(input = {}) {
  return buildStorageProviderProfile(input);
}

export function getStorageProviderCompatibilitySummary(input = {}) {
  return summarizeStorageProviderCompatibility(input);
}

export function getTenantStorageContextRecord(input = {}) {
  return buildTenantStorageContextRecord(input);
}

export function getTenantStorageContextSummary(input = {}) {
  return buildTenantStorageContextIntrospection(input);
}

export function buildTenantStorageEvent(input = {}) {
  return buildTenantStorageProvisioningEvent(input);
}

export function getWorkspaceStorageBootstrapPreview(input = {}) {
  return previewWorkspaceStorageBootstrap(input);
}

export function rotateTenantStorageCredential(input = {}) {
  return rotateTenantStorageContextCredential(input);
}
