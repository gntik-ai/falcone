import { buildCatalog } from '../../../workspace-docs-service/src/capability-catalog-builder.mjs';

export function createWorkspaceCapabilityCatalogAction({
  fetchCapabilities,
  emitAuditEvent = async () => {},
  logger = console,
  now = () => new Date()
} = {}) {
  return async function main(params = {}) {
    const auth = params.auth ?? params.authorization ?? {};
    const claims = auth.claims ?? auth;
    const workspaceId = params.workspaceId ?? params.path?.workspaceId;
    const capabilityId = params.capabilityId ?? params.path?.capabilityId ?? null;

    if (!claims.actorId || !claims.tenantId || !claims.workspaceId) {
      return errorResponse(401, 'UNAUTHORIZED', 'Missing or invalid JWT context.');
    }

    if (!workspaceId || claims.workspaceId !== workspaceId) {
      return errorResponse(403, 'FORBIDDEN', 'Workspace access denied.');
    }

    try {
      const rows = await fetchCapabilities?.({ workspaceId, capabilityId, claims, params });

      if (!Array.isArray(rows) || rows.length === 0) {
        return errorResponse(404, capabilityId ? 'CAPABILITY_NOT_FOUND' : 'WORKSPACE_NOT_FOUND', capabilityId ? 'Capability was not found.' : 'Workspace was not found.');
      }

      if (capabilityId && !rows.some((row) => (row.capability_key ?? row.id) === capabilityId)) {
        return errorResponse(404, 'CAPABILITY_NOT_FOUND', 'Capability was not found.');
      }

      const workspaceContext = {
        workspaceId,
        tenantId: claims.tenantId,
        host: params.host ?? `${workspaceId}.example.internal`,
        port: params.port ?? 443,
        resourceNames: params.resourceNames ?? {
          default: `${workspaceId}-primary`,
          extraA: `${workspaceId}-aux`,
          extraB: `https://functions.example.internal/api/v1/web/${workspaceId}/default/ping`
        },
        endpoints: params.endpoints ?? {
          realtime: params.realtimeEndpoint ?? 'wss://realtime.example.internal'
        }
      };

      const capabilities = buildCatalog(rows, workspaceContext);
      const timestamp = now().toISOString();
      const response = {
        workspaceId,
        tenantId: claims.tenantId,
        generatedAt: timestamp,
        catalogVersion: '1.0.0',
        capabilities
      };

      const auditEvent = {
        eventType: 'workspace.capability-catalog.accessed',
        workspaceId,
        tenantId: claims.tenantId,
        actorId: claims.actorId,
        capabilityId,
        accessDate: timestamp.slice(0, 10),
        correlationId: params.correlationId ?? params.headers?.['x-correlation-id'] ?? `corr-${workspaceId}`,
        timestamp
      };

      emitAuditEvent(auditEvent).catch((error) => {
        logger.warn?.({ action: 'workspace-capability-catalog', error: error.message }, 'audit-publish-failed');
      });

      return {
        statusCode: 200,
        body: response
      };
    } catch (error) {
      logger.error?.({ action: 'workspace-capability-catalog', error: error.message }, 'workspace-capability-catalog-failed');
      return errorResponse(500, 'INTERNAL_ERROR', 'Unexpected failure while building the capability catalog.');
    }
  };
}

function errorResponse(statusCode, code, message) {
  return {
    statusCode,
    body: {
      error: {
        code,
        message
      }
    }
  };
}

// Runtime entry point: membership comes from verified auth, and workspace ownership
// is checked in the database before loading catalog metadata.
export async function main(params = {}, { db } = {}) {
  const auth = params.auth;
  if (!auth?.actorId || !auth?.tenantId) return errorResponse(401, 'UNAUTHORIZED', 'Missing JWT context.');
  const workspaceIds = auth.workspaceIds ?? [auth.workspaceId];
  if (!workspaceIds.includes(params.workspaceId)) return errorResponse(403, 'FORBIDDEN', 'Workspace access denied.');
  const action = createWorkspaceCapabilityCatalogAction({
    fetchCapabilities: async ({ workspaceId, capabilityId }) => {
      const workspace = (await db.query(
        'SELECT id, tenant_id FROM workspaces WHERE id = $1 AND tenant_id = $2',
        [workspaceId, auth.tenantId]
      )).rows[0];
      if (!workspace) return [];
      const { rows } = await db.query(`
        SELECT catalog.*, CASE catalog.capability_key
          WHEN 'postgres-database' THEN EXISTS (SELECT 1 FROM workspace_databases WHERE workspace_id=$1 AND tenant_id=$2 AND status='active')
          WHEN 'mongo-collection' THEN EXISTS (SELECT 1 FROM workspace_mongo_databases WHERE workspace_id=$1 AND tenant_id=$2)
          WHEN 'kafka-events' THEN EXISTS (SELECT 1 FROM workspace_topics WHERE workspace_id=$1 AND tenant_id=$2)
          WHEN 'realtime-subscription' THEN EXISTS (SELECT 1 FROM realtime_channels WHERE workspace_id::text=$1 AND tenant_id::text=$2 AND status='active')
          WHEN 'serverless-function' THEN EXISTS (SELECT 1 FROM workspace_functions WHERE workspace_id=$1 AND tenant_id=$2)
          WHEN 'storage-bucket' THEN EXISTS (SELECT 1 FROM workspace_buckets WHERE workspace_id=$1 AND tenant_id=$2)
          ELSE false END AS enabled
        FROM capability_catalog_metadata catalog ORDER BY capability_key`, [workspaceId, auth.tenantId]);
      return rows.filter(row => !capabilityId || row.capability_key === capabilityId).map(row => ({
        ...row, enabled: Boolean(row.enabled),
        status: row.enabled ? 'active' : 'disabled'
      }));
    }
  });
  return action({ ...params, auth: { ...auth, workspaceId: params.workspaceId } });
}
