// Postgres realtime executor (change: add-realtime-postgres-cdc).
//
// Postgres change capture for the realtime engine, via a trigger + LISTEN/NOTIFY (no
// logical-replication slots — which would need wal_level=logical and risk WAL/disk bloat on
// a shared DB; that remains a heavier future option). A generic AFTER INSERT/UPDATE/DELETE
// trigger NOTIFYs a PER-TENANT channel computed as md5(schema.table:tenant_id), so a
// subscriber's LISTEN only ever receives ITS OWN tenant's changes — deletes included (the
// trigger reads OLD.tenant_id). Cross-tenant NOTIFY is impossible because the write path
// (adapter + RLS) forbids writing another tenant's tenant_id in the first place.
import crypto from 'node:crypto';
import pg from 'pg';

import { clientError } from './errors.mjs';
import { withPostgresSsl } from '../../../../packages/internal-contracts/src/transport-security.mjs';

const { Client } = pg;

const NOTIFY_FUNCTION = 'flc_realtime_notify';

// Per-(table,tenant) channel; md5 keeps it within Postgres's 63-byte channel-name limit.
function channelFor(schemaName, tableName, tenantId) {
  return `flc_rt_${crypto.createHash('md5').update(`${schemaName}.${tableName}:${tenantId}`).digest('hex')}`;
}

// Generic notify function (matches channelFor) + a per-table trigger. Idempotent.
function ensureCaptureSql(schemaName, tableName) {
  const qualified = `"${schemaName}"."${tableName}"`;
  return [
    `CREATE OR REPLACE FUNCTION public.${NOTIFY_FUNCTION}() RETURNS trigger AS $fn$
      DECLARE
        rec jsonb := to_jsonb(COALESCE(NEW, OLD));
        tid text := rec->>'tenant_id';
        ch text := 'flc_rt_' || md5(TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || COALESCE(tid, ''));
        payload jsonb := jsonb_build_object('type', lower(TG_OP), 'tenantId', tid, 'id', rec->>'id');
      BEGIN
        -- include the row only if the NOTIFY payload stays under Postgres's 8000-byte limit
        IF octet_length((payload || jsonb_build_object('row', rec))::text) <= 7900 THEN
          payload := payload || jsonb_build_object('row', rec);
        END IF;
        PERFORM pg_notify(ch, payload::text);
        RETURN NULL;
      END;
    $fn$ LANGUAGE plpgsql`,
    `GRANT EXECUTE ON FUNCTION public.${NOTIFY_FUNCTION}() TO PUBLIC`,
    `DROP TRIGGER IF EXISTS flc_realtime_trg ON ${qualified}`,
    `CREATE TRIGGER flc_realtime_trg AFTER INSERT OR UPDATE OR DELETE ON ${qualified}
       FOR EACH ROW EXECUTE FUNCTION public.${NOTIFY_FUNCTION}()`,
  ];
}

export function createPostgresRealtimeExecutor(options = {}) {
  if (typeof options.resolveConnection !== 'function') {
    throw new TypeError('createPostgresRealtimeExecutor requires a resolveConnection(workspaceId) function');
  }
  const open = new Set(); // live LISTEN clients (for shutdown)

  async function resolve(workspaceId) {
    const conn = await options.resolveConnection(workspaceId);
    if (!conn || !conn.dsn) throw clientError(`No database for workspace ${workspaceId}`, 503, 'WORKSPACE_DB_UNRESOLVED');
    return conn;
  }

  // params: { workspaceId, databaseName, schemaName, tableName, identity:{tenantId}, onChange, onError, signal }
  async function subscribe(params) {
    const tenantId = params.identity?.tenantId;
    if (!tenantId) throw clientError('Missing tenant identity', 401, 'IDENTITY_MISSING');
    const workspaceId = params.workspaceId ?? params.identity?.workspaceId;
    if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING');
    const schemaName = params.schemaName ?? 'public';
    const tableName = params.tableName;

    const { dsn, adminDsn } = await resolve(workspaceId);

    // 1. Ensure the capture trigger exists (admin connection; one-shot, idempotent).
    const admin = new Client(withPostgresSsl({ connectionString: adminDsn ?? dsn }));
    await admin.connect();
    try {
      for (const sql of ensureCaptureSql(schemaName, tableName)) await admin.query(sql);
    } finally {
      await admin.end().catch(() => {});
    }

    // 2. Dedicated LISTEN connection on the tenant-scoped channel.
    const channel = channelFor(schemaName, tableName, tenantId);
    const listener = new Client(withPostgresSsl({ connectionString: adminDsn ?? dsn }));
    await listener.connect();
    open.add(listener);

    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      params.signal?.removeEventListener?.('abort', onAbort);
      open.delete(listener);
      await listener.end().catch(() => {});
    };
    const onAbort = () => { void close(); };
    params.signal?.addEventListener?.('abort', onAbort, { once: true });

    listener.on('notification', (msg) => {
      if (msg.channel !== channel) return;
      try {
        const event = JSON.parse(msg.payload ?? '{}');
        params.onChange?.({ type: event.type, documentId: event.id ?? null, document: event.row ?? null });
      } catch {
        /* ignore malformed payload */
      }
    });
    listener.on('error', (error) => { params.onError?.(error); void close(); });

    await listener.query(`LISTEN "${channel}"`);
    return { close };
  }

  async function closeAll() {
    for (const listener of open) await listener.end().catch(() => {});
    open.clear();
  }

  return { subscribe, close: closeAll };
}
