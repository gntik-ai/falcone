// Provider-neutral durable batch records. No credential values are accepted here.
import { clientError } from './errors.mjs';

export const TERMINAL_BATCH_STATUSES = Object.freeze(['completed', 'cancelled', 'expired', 'incomplete', 'failed']);
const copy = value => structuredClone(value);
const scope = (w, t) => [t ?? '_', w];
const key = (w, id, t) => JSON.stringify([...scope(w, t), id]);
const notFound = () => clientError('LLM batch not found', 404, 'LLM_BATCH_NOT_FOUND');
export class BatchLeaseLost extends Error {
  constructor() { super('LLM batch lease lost'); this.code = 'LLM_BATCH_LEASE_LOST'; }
}
export function publicBatch(row) {
  const { providerType, endpoint, secretRef, providerState, inputSha256, idempotencyPrincipal, idempotencyKeySha256,
    leaseOwner, leaseExpiresAt, leaseVersion, ...safe } = row;
  return safe;
}
export function createLlmBatchStore({ pool } = {}) {
  if (pool) return postgresStore(pool);
  const batches = new Map();
  const items = new Map();
  const lookup = (w, id, t) => { const row = batches.get(key(w, id, t)); if (!row) throw notFound(); return row; };
  const binding = (w, t, principal, hash) => hash == null ? undefined : [...batches.values()].find(row => row.workspaceId === w
    && row.tenantId === (t ?? '_') && row.idempotencyPrincipal === principal && row.idempotencyKeySha256 === hash);
  const store = {
    async ensureSchema() {},
    async findBinding(w, t, principal, hash) { return copy(binding(w, t, principal, hash) ?? null); },
    async insert(row, pending) {
      const found = binding(row.workspaceId, row.tenantId, row.idempotencyPrincipal, row.idempotencyKeySha256);
      if (found) return { batch: copy(found), created: false };
      const k = key(row.workspaceId, row.batchId, row.tenantId);
      batches.set(k, copy(row)); items.set(k, pending.map(customId => ({ customId, status: 'pending' })));
      return { batch: copy(row), created: true };
    },
    async list(w, t, { limit, cursor } = {}) {
      return copy([...batches.values()].filter(row => row.workspaceId === w && row.tenantId === (t ?? '_'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.batchId.localeCompare(a.batchId))
        .filter(row => !cursor || row.createdAt < cursor[0] || (row.createdAt === cursor[0] && row.batchId < cursor[1])).slice(0, limit));
    },
    async get(w, id, t) { return copy(lookup(w, id, t)); },
    async delete(w, id, t) {
      const row = lookup(w, id, t);
      if (!TERMINAL_BATCH_STATUSES.includes(row.status)) throw clientError('Batch is not terminal', 409, 'LLM_BATCH_NOT_TERMINAL');
      const k = key(w, id, t); items.delete(k); batches.delete(k); return { removed: true };
    },
    async requestCancel(w, id, t, now) {
      const row = lookup(w, id, t);
      if (TERMINAL_BATCH_STATUSES.includes(row.status) || row.cancelRequestedAt) return copy(row);
      // An intent must not revoke the creating request's fence or accelerate recovery.
      if (row.status === 'submitting' || row.status === 'submit_uncertain') {
        Object.assign(row, { cancelRequestedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
        return copy(row);
      }
      Object.assign(row, { cancelRequestedAt: new Date(now).toISOString(), status: row.providerBatchId ? 'canceling' : row.status,
        nextPollAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), leaseVersion: row.leaseVersion + 1, leaseOwner: null, leaseExpiresAt: null });
      return copy(row);
    },
    async allItems(w, id, t) { lookup(w, id, t); return copy(items.get(key(w, id, t))); },
    async assertLease(row) {
      const live = lookup(row.workspaceId, row.batchId, row.tenantId);
      if (live.status !== row.status || live.leaseVersion !== row.leaseVersion) throw new BatchLeaseLost();
    },
    async claim({ now, owner, limit = 20, batchId, workspaceId, tenantId }) {
      const claimed = [];
      for (const row of batches.values()) {
        if (TERMINAL_BATCH_STATUSES.includes(row.status) || Date.parse(row.nextPollAt) > now || Date.parse(row.leaseExpiresAt) > now
          || (batchId && (row.batchId !== batchId || row.workspaceId !== workspaceId || row.tenantId !== (tenantId ?? '_')))) continue;
        Object.assign(row, { leaseOwner: owner, leaseExpiresAt: new Date(now + 300000).toISOString(), leaseVersion: row.leaseVersion + 1 });
        claimed.push(copy(row)); if (claimed.length >= limit) break;
      }
      return claimed;
    },
    async ingest(row, item, usageStore) {
      await store.assertLease(row);
      const live = items.get(key(row.workspaceId, row.batchId, row.tenantId)).find(i => i.customId === item.customId);
      if (!live) throw clientError('Invalid batch result', 502, 'LLM_PROVIDER_RESPONSE_INVALID');
      if (live.status !== 'pending') return false;
      if (item.status === 'succeeded') await usageStore.recordUsage(row.workspaceId, { tenantId: row.tenantId, model: row.model, ...item.usage });
      Object.assign(live, copy(item)); return true;
    },
    async finish(row, patch, markMissing = false) {
      await store.assertLease(row);
      const pending = items.get(key(row.workspaceId, row.batchId, row.tenantId)).filter(i => i.status === 'pending');
      if (!markMissing && pending.length) return null;
      if (markMissing) for (const item of pending) item.status = 'missing';
      return store.update(row, { ...patch, missingCount: pending.length });
    },
    async update(row, patch) {
      const live = lookup(row.workspaceId, row.batchId, row.tenantId);
      if (live.status !== row.status || live.leaseVersion !== row.leaseVersion) throw new BatchLeaseLost();
      // Read the durable intent atomically with acceptance, rather than the caller's snapshot.
      const status = patch.status === 'in_progress' && live.cancelRequestedAt ? 'canceling' : patch.status;
      Object.assign(live, copy(patch));
      if (status) live.status = status;
      return copy(live);
    },
  };
  // Serialize the in-memory equivalent of database transactions, including usage recording.
  let tail = Promise.resolve();
  const result = {};
  for (const [name, fn] of Object.entries(store)) result[name] = (...args) => {
    const pending = tail.then(() => fn(...args)); tail = pending.catch(() => {}); return pending;
  };
  return result;
}

const snake = value => value.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const camel = value => value.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const batchFields = ['tenantId', 'workspaceId', 'batchId', 'connectionId', 'providerType', 'endpoint', 'secretRef', 'model',
  'providerBatchId', 'providerState', 'status', 'requestCount', 'providerCounts', 'missingCount', 'inputSha256', 'idempotencyPrincipal', 'idempotencyKeySha256',
  'lastErrorCode', 'cancelRequestedAt', 'cancelAcknowledgedAt', 'expiresAt', 'endedAt', 'resultsAttempts', 'nextPollAt', 'createdAt', 'updatedAt', 'leaseOwner', 'leaseExpiresAt', 'leaseVersion'];
const mutableFields = new Set(['providerBatchId', 'providerState', 'status', 'providerCounts', 'missingCount', 'idempotencyKeySha256',
  'lastErrorCode', 'cancelRequestedAt', 'cancelAcknowledgedAt', 'expiresAt', 'endedAt', 'resultsAttempts', 'nextPollAt', 'updatedAt', 'leaseOwner', 'leaseExpiresAt', 'leaseVersion']);
const rowFromDb = row => row && Object.fromEntries(Object.entries(row).map(([name, value]) => [camel(name), value instanceof Date ? value.toISOString()
  : name === 'lease_version' ? Number(value) : value]));
const fenceValues = row => [row.tenantId, row.workspaceId, row.batchId, row.status, row.leaseVersion];
const fence = 'tenant_id=$1 AND workspace_id=$2 AND batch_id=$3 AND status=$4 AND lease_version=$5';
function itemFromDb(row) {
  const { tenantId, workspaceId, batchId, promptTokens, completionTokens, totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, ...item } = rowFromDb(row);
  return { ...item, ...(item.status === 'succeeded' ? { usage: { promptTokens, completionTokens, totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens } } : {}) };
}

function postgresStore(pool) {
  async function transaction(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function locked(client, row) {
    const res = await client.query(`SELECT batch_id FROM workspace_llm_batches WHERE ${fence} FOR UPDATE`, fenceValues(row));
    if (!res.rowCount) throw new BatchLeaseLost();
  }
  async function update(row, patch, client = pool) {
    const entries = Object.entries(patch);
    if (!entries.length || entries.some(([name]) => !mutableFields.has(name))) throw new Error('Invalid batch update');
    const values = [...fenceValues(row), ...entries.map(([, value]) => value)];
    const assignments = entries.map(([name, value], i) => {
      const parameter = `$${i + 6}`;
      // Acceptance and an earlier cancel intent must be merged under the same row lock.
      const expression = name === 'status' && value === 'in_progress'
        ? `CASE WHEN cancel_requested_at IS NOT NULL THEN 'canceling' ELSE ${parameter} END` : parameter;
      return `${snake(name)}=${expression}`;
    });
    const res = await client.query(`UPDATE workspace_llm_batches SET ${assignments.join(',')}
      WHERE ${fence} RETURNING *`, values);
    if (!res.rowCount) throw new BatchLeaseLost();
    return rowFromDb(res.rows[0]);
  }
  async function get(w, id, t, client = pool) {
    const res = await client.query('SELECT * FROM workspace_llm_batches WHERE tenant_id=$1 AND workspace_id=$2 AND batch_id=$3', [...scope(w, t), id]);
    if (!res.rowCount) throw notFound();
    return rowFromDb(res.rows[0]);
  }
  async function findBinding(w, t, principal, hash, client = pool) {
    if (hash == null) return null;
    const res = await client.query(`SELECT * FROM workspace_llm_batches WHERE tenant_id=$1 AND workspace_id=$2 AND idempotency_principal=$3 AND idempotency_key_sha256=$4`, [...scope(w, t), principal, hash]);
    return rowFromDb(res.rows[0]) ?? null;
  }
  return {
    pool, get, update, findBinding,
    async ensureSchema() {
      await transaction(async client => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('workspace-llm-batches-schema'))");
        await client.query(`CREATE TABLE IF NOT EXISTS workspace_llm_batches (
          tenant_id text NOT NULL, workspace_id text NOT NULL, batch_id text NOT NULL,
          connection_id text NOT NULL, provider_type text NOT NULL, endpoint text NOT NULL, secret_ref jsonb NOT NULL,
          model text NOT NULL, provider_batch_id text, provider_state jsonb NOT NULL DEFAULT '{}',
          status text NOT NULL CHECK (status IN ('submitting','submit_uncertain','in_progress','canceling','completed','cancelled','expired','incomplete','failed')),
          request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 1000), provider_counts jsonb NOT NULL DEFAULT '{}',
          missing_count integer NOT NULL DEFAULT 0 CHECK (missing_count >= 0), input_sha256 text NOT NULL,
          idempotency_principal text, idempotency_key_sha256 text, last_error_code text,
          cancel_requested_at timestamptz, cancel_acknowledged_at timestamptz, expires_at timestamptz, ended_at timestamptz,
          results_attempts integer NOT NULL DEFAULT 0 CHECK (results_attempts >= 0), next_poll_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
          lease_owner text, lease_expires_at timestamptz, lease_version bigint NOT NULL DEFAULT 0,
          PRIMARY KEY (tenant_id,workspace_id,batch_id),
          CHECK (idempotency_key_sha256 IS NULL OR idempotency_principal IS NOT NULL))`);
        await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wlb_idempotency ON workspace_llm_batches
          (tenant_id,workspace_id,idempotency_principal,idempotency_key_sha256) WHERE idempotency_key_sha256 IS NOT NULL`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_wlb_due ON workspace_llm_batches(next_poll_at)
          WHERE status IN ('submitting','submit_uncertain','in_progress','canceling')`);
        await client.query(`CREATE TABLE IF NOT EXISTS workspace_llm_batch_items (
          tenant_id text NOT NULL, workspace_id text NOT NULL, batch_id text NOT NULL, custom_id text NOT NULL CHECK (custom_id ~ '^[A-Za-z0-9_-]{1,64}$'),
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','errored','canceled','expired','missing')),
          content text, finish_reason text, model text,
          prompt_tokens integer, completion_tokens integer, total_tokens integer, cache_read_tokens integer, cache_write_tokens integer, reasoning_tokens integer,
          error_code text, provider_detail jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (tenant_id,workspace_id,batch_id,custom_id),
          FOREIGN KEY (tenant_id,workspace_id,batch_id) REFERENCES workspace_llm_batches(tenant_id,workspace_id,batch_id) ON DELETE CASCADE)`);
      });
    },
    async insert(row, pending) {
      return transaction(async client => {
        // A concurrent 429 may clear a binding between ON CONFLICT and SELECT; retry only
        // the local insertion, never the provider's creating call.
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await client.query(`INSERT INTO workspace_llm_batches (${batchFields.map(snake).join(',')})
            VALUES (${batchFields.map((_, i) => `$${i + 1}`).join(',')})
            ON CONFLICT (tenant_id,workspace_id,idempotency_principal,idempotency_key_sha256) WHERE idempotency_key_sha256 IS NOT NULL DO NOTHING RETURNING *`, batchFields.map(name => row[name]));
          if (!res.rowCount) {
            const found = await findBinding(row.workspaceId, row.tenantId, row.idempotencyPrincipal, row.idempotencyKeySha256, client);
            if (found) return { batch: found, created: false };
            continue;
          }
          await client.query(`INSERT INTO workspace_llm_batch_items (tenant_id,workspace_id,batch_id,custom_id,status)
            SELECT $1,$2,$3,custom_id,'pending' FROM unnest($4::text[]) AS custom_id`, [row.tenantId, row.workspaceId, row.batchId, pending]);
          return { batch: rowFromDb(res.rows[0]), created: true };
        }
        throw clientError('Batch binding changed concurrently', 409, 'IDEMPOTENCY_KEY_IN_PROGRESS');
      });
    },
    async list(w, t, { limit = null, cursor } = {}) {
      const res = await pool.query(`SELECT * FROM workspace_llm_batches WHERE tenant_id=$1 AND workspace_id=$2
        AND ($3::timestamptz IS NULL OR (created_at,batch_id)<($3,$4)) ORDER BY created_at DESC,batch_id DESC LIMIT $5`,
      [...scope(w, t), cursor?.[0] ?? null, cursor?.[1] ?? null, limit]);
      return res.rows.map(rowFromDb);
    },
    async allItems(w, id, t) {
      await get(w, id, t);
      const res = await pool.query('SELECT * FROM workspace_llm_batch_items WHERE tenant_id=$1 AND workspace_id=$2 AND batch_id=$3 ORDER BY custom_id COLLATE "C"', [...scope(w, t), id]);
      return res.rows.map(itemFromDb);
    },
    async assertLease(row) {
      const res = await pool.query(`SELECT batch_id FROM workspace_llm_batches WHERE ${fence}`, fenceValues(row));
      if (!res.rowCount) throw new BatchLeaseLost();
    },
    async claim({ now, owner, limit = 20, batchId, workspaceId, tenantId }) {
      return transaction(async client => {
        const res = await client.query(`WITH due AS (
          SELECT tenant_id,workspace_id,batch_id FROM workspace_llm_batches
          WHERE status IN ('submitting','submit_uncertain','in_progress','canceling') AND next_poll_at <= $1
            AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
            AND ($4::text IS NULL OR (batch_id=$4 AND workspace_id=$5 AND tenant_id=$6))
          ORDER BY next_poll_at LIMIT $3 FOR UPDATE SKIP LOCKED
        ) UPDATE workspace_llm_batches b SET lease_owner=$2,lease_expires_at=$1::timestamptz + interval '5 minutes',lease_version=b.lease_version+1
          FROM due WHERE b.tenant_id=due.tenant_id AND b.workspace_id=due.workspace_id AND b.batch_id=due.batch_id RETURNING b.*`,
        [new Date(now).toISOString(), owner, Math.min(20, limit), batchId ?? null, workspaceId ?? null, tenantId ?? '_']);
        return res.rows.map(rowFromDb);
      });
    },
    async delete(w, id, t) {
      return transaction(async client => {
        const row = await get(w, id, t, client);
        if (!TERMINAL_BATCH_STATUSES.includes(row.status)) throw clientError('Batch is not terminal', 409, 'LLM_BATCH_NOT_TERMINAL');
        const res = await client.query(`DELETE FROM workspace_llm_batches WHERE ${fence} RETURNING batch_id`, fenceValues(row));
        if (!res.rowCount) throw new BatchLeaseLost();
        return { removed: true };
      });
    },
    async requestCancel(w, id, t, now) {
      return transaction(async client => {
        const res = await client.query('SELECT * FROM workspace_llm_batches WHERE tenant_id=$1 AND workspace_id=$2 AND batch_id=$3 FOR UPDATE', [...scope(w, t), id]);
        if (!res.rowCount) throw notFound();
        const row = rowFromDb(res.rows[0]);
        if (TERMINAL_BATCH_STATUSES.includes(row.status) || row.cancelRequestedAt) return row;
        if (row.status === 'submitting' || row.status === 'submit_uncertain') {
          return update(row, { cancelRequestedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }, client);
        }
        return update(row, { cancelRequestedAt: new Date(now).toISOString(), status: row.providerBatchId ? 'canceling' : row.status,
          nextPollAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), leaseVersion: row.leaseVersion + 1, leaseOwner: null, leaseExpiresAt: null }, client);
      });
    },
    async ingest(row, item, usageStore) {
      return transaction(async client => {
        await locked(client, row);
        const res = await client.query(`UPDATE workspace_llm_batch_items SET status=$5,content=$6,finish_reason=$7,model=$8,
          prompt_tokens=$9,completion_tokens=$10,total_tokens=$11,cache_read_tokens=$12,cache_write_tokens=$13,reasoning_tokens=$14,error_code=$15,provider_detail=$16
          WHERE tenant_id=$1 AND workspace_id=$2 AND batch_id=$3 AND custom_id=$4 AND status='pending' RETURNING custom_id`,
        [row.tenantId, row.workspaceId, row.batchId, item.customId, item.status, item.content ?? null, item.finishReason ?? null, item.model ?? row.model,
          ...['promptTokens', 'completionTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(k => item.usage?.[k] ?? null), item.errorCode ?? null, item.providerDetail ?? {}]);
        if (!res.rowCount) return false;
        if (item.status === 'succeeded') await usageStore.recordUsage(row.workspaceId, { tenantId: row.tenantId, model: row.model, ...item.usage }, client);
        return true;
      });
    },
    async finish(row, patch, markMissing = false) {
      return transaction(async client => {
        await locked(client, row);
        let count;
        if (markMissing) count = (await client.query(`UPDATE workspace_llm_batch_items SET status='missing'
          WHERE tenant_id=$1 AND workspace_id=$2 AND batch_id=$3 AND status='pending' RETURNING custom_id`, [row.tenantId, row.workspaceId, row.batchId])).rowCount;
        else {
          const res = await client.query(`SELECT count(*) AS total,count(*) FILTER (WHERE status='pending') AS pending FROM workspace_llm_batch_items
            WHERE tenant_id=$1 AND workspace_id=$2 AND batch_id=$3`, [row.tenantId, row.workspaceId, row.batchId]);
          if (Number(res.rows[0].pending) || Number(res.rows[0].total) !== row.requestCount) return null;
          count = 0;
        }
        return update(row, { ...patch, missingCount: count }, client);
      });
    },
  };
}
