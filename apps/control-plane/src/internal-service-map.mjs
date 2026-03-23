import {
  CONTROL_API_SERVICE_ID,
  getContract,
  getService,
  listInteractionFlows
} from '../../../services/internal-contracts/src/index.mjs';

export const controlApiBoundary = getService(CONTROL_API_SERVICE_ID);
export const controlApiCommandContract = getContract('control_api_command');
export const controlPlaneInteractionFlows = listInteractionFlows().filter(
  (flow) => flow.entry_service === CONTROL_API_SERVICE_ID
);
