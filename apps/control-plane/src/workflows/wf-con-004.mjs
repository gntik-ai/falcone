const snapshot = (step, params = {}, sagaCtx = {}) => ({ step, tenantId: sagaCtx.tenantId ?? params.tenantId ?? null, workspaceId: sagaCtx.workspaceId ?? params.workspaceId ?? null, redacted: true });

export async function createKeycloakCredential(params, sagaCtx) { return snapshot('create-keycloak-credential', params, sagaCtx); }
export async function revertKeycloakCredential() {}
export async function syncApisixConsumer(params, sagaCtx) { return snapshot('sync-apisix-consumer', params, sagaCtx); }
export async function removeApisixConsumer() {}
export async function recordCredentialMetadata(params, sagaCtx) { return snapshot('record-credential-metadata', params, sagaCtx); }
export async function deleteCredentialMetadata() {}
