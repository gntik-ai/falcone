const snapshot = (step, params = {}, sagaCtx = {}) => ({ step, tenantId: sagaCtx.tenantId ?? params.tenantId ?? null, workspaceId: sagaCtx.workspaceId ?? params.workspaceId ?? null });

/** Forward is query-before-create/idempotent by contract. */
export async function assignKeycloakRole(params, sagaCtx) { return snapshot('assign-keycloak-role', params, sagaCtx); }
/** Compensation is query-before-delete/idempotent by contract. */
export async function revokeKeycloakRole() {}
export async function updateMembershipRecord(params, sagaCtx) { return snapshot('update-membership-record', params, sagaCtx); }
export async function revertMembershipRecord() {}
