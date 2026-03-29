const snapshot = (step, params = {}, sagaCtx = {}) => ({ step, tenantId: sagaCtx.tenantId ?? params.tenantId ?? null, workspaceId: sagaCtx.workspaceId ?? params.workspaceId ?? null });

export async function createKeycloakClient(params, sagaCtx) { return snapshot('create-keycloak-client', params, sagaCtx); }
export async function deleteKeycloakClient() {}
export async function createPostgresqlWorkspace(params, sagaCtx) { return snapshot('create-postgresql-workspace', params, sagaCtx); }
export async function deletePostgresqlWorkspace() {}
export async function reserveS3Storage(params, sagaCtx) { return snapshot('reserve-s3-storage', params, sagaCtx); }
export async function releaseS3Storage() {}
