import {
  PROVISIONING_ORCHESTRATOR_SERVICE_ID,
  getContract,
  getService,
  listAdapterPortsForConsumer,
  listInteractionFlows
} from '../../internal-contracts/src/index.mjs';

export const provisioningOrchestratorBoundary = getService(PROVISIONING_ORCHESTRATOR_SERVICE_ID);
export const provisioningRequestContract = getContract('provisioning_request');
export const provisioningResultContract = getContract('provisioning_result');
export const provisioningAdapterPorts = listAdapterPortsForConsumer(PROVISIONING_ORCHESTRATOR_SERVICE_ID);
export const provisioningFlows = listInteractionFlows().filter(
  (flow) => flow.entry_service === 'control_api'
);
