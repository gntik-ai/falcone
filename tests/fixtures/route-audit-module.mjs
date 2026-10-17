// HTTP module fixture: trusted scope is independent of the request body (#971).
export async function main() {
  return { statusCode: 201, auditScope: { tenantId: 'module-tenant', workspaceId: 'module-workspace' },
    body: { value: 'private-module-body' } };
}
