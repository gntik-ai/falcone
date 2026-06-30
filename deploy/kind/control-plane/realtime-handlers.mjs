import * as store from './tenant-store.mjs';
import { callerTenantScope } from './tenant-scope.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

function stripTrailingSlash(value) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\/+$/, '') : null;
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function resolveRealtimeEndpointUrl(ctx = {}) {
  const configured = stripTrailingSlash(
    process.env.REALTIME_PUBLIC_ENDPOINT_URL
      ?? process.env.PUBLIC_REALTIME_ENDPOINT_URL
      ?? process.env.REALTIME_ENDPOINT_URL
  );
  if (configured) return configured;

  const headers = ctx.req?.headers ?? {};
  const host = headerValue(headers, 'x-forwarded-host') ?? headerValue(headers, 'host');
  if (!host) return null;
  const proto = String(headerValue(headers, 'x-forwarded-proto') ?? 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const wsProto = proto === 'https' ? 'wss' : 'ws';
  return `${wsProto}://${host}`;
}

function inferDataSourceType(row) {
  const kind = String(row.data_source_kind ?? row.dataSourceKind ?? '').toLowerCase();
  if (kind === 'postgres' || kind === 'postgresql') return 'postgresql';
  if (kind === 'mongo' || kind === 'mongodb' || kind === 'documentdb') return 'mongodb';
  if (kind) return kind;
  const channelType = String(row.channel_type ?? row.channelType ?? '').toLowerCase();
  if (channelType.includes('mongo')) return 'mongodb';
  if (channelType.includes('postgres')) return 'postgresql';
  return 'unknown';
}

function dataSourceOut(row) {
  return {
    id: row.id ?? null,
    type: inferDataSourceType(row),
    channelType: row.channel_type ?? row.channelType ?? null,
    dataSourceRef: row.data_source_ref ?? row.dataSourceRef ?? null,
    displayName: row.display_name ?? row.displayName ?? null,
    description: row.description ?? null,
    status: row.status ?? 'available',
  };
}

function isMissingRealtimeChannels(error) {
  return error?.code === '42P01' && /realtime_channels/i.test(String(error?.message ?? ''));
}

export async function listWorkspaceRealtimeDataSources(pool, tenantId, workspaceId) {
  try {
    const { rows } = await pool.query(
      `SELECT id, channel_type, data_source_kind, data_source_ref, display_name, description, status
         FROM realtime_channels
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND status = 'available'
        ORDER BY channel_type, data_source_ref`,
      [tenantId, workspaceId],
    );
    return rows.map(dataSourceOut);
  } catch (error) {
    if (isMissingRealtimeChannels(error)) return [];
    throw error;
  }
}

// GET /v1/workspaces/{workspaceId}/realtime
//
// ConsoleRealtimePage consumes this metadata shape to decide whether to render
// snippets and which channel types are usable. The workspace id comes from the
// path, while tenant scope comes only from the verified JWT identity.
export async function getWorkspaceRealtime(ctx) {
  const st = ctx.store ?? store;
  const workspaceId = ctx.params?.workspaceId;
  const ws = await st.getWorkspace(ctx.pool, workspaceId);
  const scope = callerTenantScope(ctx.identity);
  if (!ws || (scope != null && ws.tenant_id !== scope)) {
    return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
  }

  const dataSources = await listWorkspaceRealtimeDataSources(ctx.pool, ws.tenant_id, ws.id);
  return ok(200, {
    workspaceId: ws.id,
    realtimeEndpointUrl: resolveRealtimeEndpointUrl(ctx),
    features: { realtime: dataSources.length > 0 },
    dataSources,
  });
}

export const REALTIME_HANDLERS = {
  getWorkspaceRealtime,
};
