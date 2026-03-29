const snapshot = (step, params = {}, sagaCtx = {}) => ({ step, tenantId: sagaCtx.tenantId ?? params.tenantId ?? null, workspaceId: sagaCtx.workspaceId ?? params.workspaceId ?? null });

export async function createKeycloakRealm(params, sagaCtx) { return snapshot('create-keycloak-realm', params, sagaCtx); }
export async function deleteKeycloakRealm() {}
export async function createPostgresqlBoundary(params, sagaCtx) { return snapshot('create-postgresql-boundary', params, sagaCtx); }
export async function deletePostgresqlBoundary() {}
export async function createKafkaNamespace(params, sagaCtx) { return snapshot('create-kafka-namespace', params, sagaCtx); }
export async function deleteKafkaNamespace() {}
export async function configureApisixRoutes(params, sagaCtx) { return snapshot('configure-apisix-routes', params, sagaCtx); }
export async function removeApisixRoutes() {}
