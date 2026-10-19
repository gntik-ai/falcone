// Append-only, tenant/workspace-scoped LLM ledger. Monetary values cross JSON as decimal strings.
import { createLlmPricingStore, costMicros } from './llm-pricing-store.mjs';
import { clientError } from './errors.mjs';

const tenant = value => value ?? '_';
const scopeKey = (w, t) => JSON.stringify([tenant(t), w]);
const snake = key => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const dimensions = ['requestId', 'attempt', 'connectionId', 'providerType', 'mode', 'executionId', 'nodeId', 'batchId', 'batchItemId',
  'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'status', 'priceSource', 'priceListId', 'priceCatalogVersion', 'currency', 'costMicros', 'estimatedCostMicros'];
const counts = ['promptTokens', 'completionTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
const groups = { model: 'model', connection: 'connectionId', execution: 'executionId', node: 'nodeId', batch: 'batchId', day: 'day' };
const monetary = new Set(['costMicros', 'estimatedCostMicros']);

function usageRow(w, input, now) {
  return { tenantId: tenant(input.tenantId), workspaceId: w, model: input.model ?? null,
    ...Object.fromEntries(dimensions.map(key => [key, input[key] == null ? null : monetary.has(key) ? String(input[key]) : input[key]])),
    ...Object.fromEntries(counts.map(key => [key, input[key] == null && counts.indexOf(key) >= 3 ? null : Number(input[key]) || 0])),
    status: input.status ?? 'recorded', createdAt: new Date(now()).toISOString() };
}
function rowFromDb(row) {
  const result = { usageId: String(row.usage_id), tenantId: row.tenant_id, workspaceId: row.workspace_id, model: row.model,
    createdAt: row.ledger_created_at ?? (row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at) };
  for (const key of [...counts, ...dimensions]) {
    const value = row[snake(key)];
    result[key] = value == null ? null : monetary.has(key) ? String(value) : counts.includes(key) || key === 'attempt' ? Number(value) : value;
  }
  return result;
}
function queryOptions(options = {}, paged = false) {
  const out = { ...options };
  for (const field of ['from', 'to']) {
    if (out[field] != null) {
      if (typeof out[field] !== 'string' || !Number.isFinite(Date.parse(out[field]))) throw clientError('Invalid date range', 400, 'INVALID_LLM_USAGE_QUERY');
      out[field] = new Date(out[field]).toISOString();
    }
  }
  if (out.from && out.to && out.from >= out.to) throw clientError('Invalid date range', 400, 'INVALID_LLM_USAGE_QUERY');
  if (paged) {
    out.limit = Number(options.limit ?? 50);
    if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 500) throw clientError('Invalid page limit', 400, 'INVALID_LLM_USAGE_QUERY');
    if (out.cursor) {
      try {
        out.cursor = JSON.parse(Buffer.from(out.cursor, 'base64url').toString());
        if (!Array.isArray(out.cursor) || out.cursor.length !== 2
          || typeof out.cursor[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(out.cursor[0]) || !Number.isFinite(Date.parse(out.cursor[0]))
          || typeof out.cursor[1] !== 'string' || !/^[1-9][0-9]*$/.test(out.cursor[1]) || BigInt(out.cursor[1]) > 9223372036854775807n) throw new Error();
      } catch { throw clientError('Invalid page cursor', 400, 'INVALID_LLM_USAGE_QUERY'); }
    }
  }
  return out;
}
function summarize(rows, groupBy = 'model') {
  if (!Object.hasOwn(groups, groupBy)) throw clientError('Invalid groupBy', 400, 'INVALID_LLM_USAGE_QUERY');
  const field = groups[groupBy], buckets = new Map();
  for (const row of rows.filter(row => row.status !== 'budget_refused')) {
    const value = field === 'day' ? new Date(row.createdAt).toISOString().slice(0, 10) : row[field] ?? null;
    const acc = buckets.get(value) ?? { [field]: value, requests: 0, attempts: 0, ...Object.fromEntries(counts.map(key => [key, 0])), costMicros: {}, ids: new Set() };
    if (row.requestId == null || !acc.ids.has(row.requestId)) acc.requests++;
    if (row.requestId != null) acc.ids.add(row.requestId);
    acc.attempts++;
    counts.forEach(key => { acc[key] += Number(row[key]) || 0; });
    if (row.currency && row.costMicros != null) acc.costMicros[row.currency] = String(BigInt(acc.costMicros[row.currency] ?? 0) + BigInt(row.costMicros));
    buckets.set(value, acc);
  }
  return { items: [...buckets.values()].sort((a, b) => String(a[field]).localeCompare(String(b[field]))).map(({ ids, ...row }) => row) };
}
function rollup(rows) {
  const summary = summarize(rows);
  return { items: summary.items.map(({ model, promptTokens, completionTokens, totalTokens }) => ({ model, promptTokens, completionTokens, totalTokens })) };
}

export function createLlmLedgerStore({ pool, now = Date.now, priceCatalog } = {}) {
  const pricing = createLlmPricingStore({ pool, now, priceCatalog });
  const rows = [];
  const scoped = (w, t) => rows.filter(row => scopeKey(row.workspaceId, row.tenantId) === scopeKey(w, t));
  async function readRows(w, options = {}, client = pool) {
    const { tenantId, from, to } = options;
    if (!pool) return scoped(w, tenantId).filter(row => (!from || Date.parse(row.createdAt) >= Date.parse(from)) && (!to || Date.parse(row.createdAt) < Date.parse(to)));
    const res = await client.query(`SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ledger_created_at FROM workspace_llm_usage
      WHERE tenant_id=$1 AND workspace_id=$2 AND ($3::timestamptz IS NULL OR created_at >= $3)
      AND ($4::timestamptz IS NULL OR created_at < $4) ORDER BY created_at DESC, usage_id DESC`, [tenant(tenantId), w, from ?? null, to ?? null]);
    return res.rows.map(rowFromDb);
  }
  const store = {
    ...pricing,
    ...(pool ? { pool } : {}),
    async ensureSchema() {
      await pricing.ensureSchema();
      if (!pool) return;
      await pool.query(`CREATE TABLE IF NOT EXISTS workspace_llm_usage (
        tenant_id text NOT NULL, workspace_id text NOT NULL, model text,
        prompt_tokens integer NOT NULL DEFAULT 0, completion_tokens integer NOT NULL DEFAULT 0,
        total_tokens integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
      )`);
      const integers = new Set(['attempt', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']);
      for (const key of dimensions) await pool.query(`ALTER TABLE workspace_llm_usage ADD COLUMN IF NOT EXISTS ${snake(key)} ${integers.has(key) ? 'integer' : monetary.has(key) ? 'bigint' : 'text'}`);
      await pool.query('ALTER TABLE workspace_llm_usage ADD COLUMN IF NOT EXISTS usage_id bigserial');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_wlu_scope ON workspace_llm_usage (tenant_id, workspace_id)');
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_wlu_request_attempt ON workspace_llm_usage (tenant_id, workspace_id, request_id, attempt) WHERE request_id IS NOT NULL');
    },
    async recordUsage(w, input = {}, client = pool) {
      return pricing.transaction(async conn => {
        const row = usageRow(w, input, now);
        let price = await pricing.resolvePrice(w, row, conn);
        if (price?.priceSource === 'platform' && row.status !== 'budget_refused'
          && !await pricing.lockCurrency(w, row.tenantId, price.currency, conn, false)) price = await pricing.resolvePrice(w, row, conn);
        if (price) {
          for (const field of ['priceSource', 'priceListId', 'priceCatalogVersion', 'currency']) row[field] = price[field];
          row.costMicros = row.status === 'budget_refused' ? null : costMicros(row, price);
        }
        if (!pool) {
          if (row.requestId != null && scoped(w, row.tenantId).some(r => r.requestId === row.requestId && r.attempt === row.attempt)) return;
          rows.push({ ...row, usageId: String(rows.length + 1) });
          return;
        }
        const fields = ['tenantId', 'workspaceId', 'model', ...counts.slice(0, 3), ...dimensions, 'createdAt'];
        await conn.query(`INSERT INTO workspace_llm_usage (${fields.map(snake).join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`, fields.map(key => row[key]));
      }, client);
    },
    async getMonthSpend(w, { tenantId, currency } = {}) {
      const start = new Date(now());
      start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
      if (pool) {
        const res = await pool.query(`SELECT COALESCE(SUM(cost_micros),0)::text AS cost FROM workspace_llm_usage
          WHERE tenant_id=$1 AND workspace_id=$2 AND currency=$3 AND created_at >= $4 AND status IS DISTINCT FROM 'budget_refused'`, [tenant(tenantId), w, currency, start.toISOString()]);
        return res.rows[0].cost;
      }
      return String(scoped(w, tenantId).filter(r => r.currency === currency && r.status !== 'budget_refused' && Date.parse(r.createdAt) >= +start)
        .reduce((sum, r) => sum + BigInt(r.costMicros ?? 0), 0n));
    },
    async checkBudget(w, identity, items) {
      const budget = await pricing.getBudget(w, identity);
      if (!budget) return;
      const price = await pricing.resolvePrice(w, identity);
      if (!price) {
        await store.recordUsage(w, { ...identity, status: 'budget_refused' });
        throw clientError('No price available for budgeted model', 422, 'LLM_PRICE_MISSING');
      }
      let estimate = 0n;
      for (const item of items) {
        let characters = 0;
        for (const message of item.messages) {
          if (typeof message?.content === 'string') characters += message.content.length;
          else if (Array.isArray(message?.content) && message.content.every(part => part && ['text', 'input_text'].includes(part.type) && typeof part.text === 'string')) {
            characters += message.content.reduce((sum, part) => sum + part.text.length, 0);
          } else throw clientError('Message content cannot be estimated', 400, 'INVALID_LLM_MESSAGES');
        }
        const output = item.maxTokens ?? item.maxOutputTokens ?? 4096;
        if (!Number.isSafeInteger(output) || output < 1) throw clientError('Invalid output token estimate', 400, 'INVALID_LLM_MESSAGES');
        estimate += BigInt(costMicros({ promptTokens: Math.ceil(characters / 4), completionTokens: output }, price, true));
      }
      const spend = await store.getMonthSpend(w, { ...identity, currency: budget.currency });
      if (BigInt(spend) + estimate > BigInt(budget.limitMicros)) {
        await store.recordUsage(w, { ...identity, status: 'budget_refused', estimatedCostMicros: String(estimate) });
        throw clientError('Workspace LLM budget exceeded', 422, 'LLM_BUDGET_EXCEEDED');
      }
    },
    async getRollup(w, t) {
      if (!pool) return rollup(scoped(w, t));
      const res = await pool.query(`SELECT model, SUM(prompt_tokens)::bigint AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens, SUM(total_tokens)::bigint AS total_tokens
        FROM workspace_llm_usage WHERE tenant_id=$1 AND workspace_id=$2 AND status IS DISTINCT FROM 'budget_refused'
        GROUP BY model ORDER BY model`, [tenant(t), w]);
      return { items: res.rows.map(row => ({ model: row.model ?? null, promptTokens: Number(row.prompt_tokens) || 0,
        completionTokens: Number(row.completion_tokens) || 0, totalTokens: Number(row.total_tokens) || 0 })) };
    },
    async getLedger(w, options = {}) {
      const query = queryOptions(options, true);
      let found;
      if (pool) {
        const res = await pool.query(`SELECT *, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ledger_created_at FROM workspace_llm_usage
          WHERE tenant_id=$1 AND workspace_id=$2 AND ($3::timestamptz IS NULL OR created_at >= $3)
          AND ($4::timestamptz IS NULL OR created_at < $4)
          AND ($5::timestamptz IS NULL OR (created_at, usage_id) < ($5, $6::bigint))
          ORDER BY created_at DESC, usage_id DESC LIMIT $7`, [tenant(query.tenantId), w, query.from ?? null, query.to ?? null, query.cursor?.[0] ?? null, query.cursor?.[1] ?? null, query.limit + 1]);
        found = res.rows.map(rowFromDb);
      } else {
        found = (await readRows(w, query)).filter(r => !query.cursor || r.createdAt < query.cursor[0] || r.createdAt === query.cursor[0] && BigInt(r.usageId) < BigInt(query.cursor[1]));
        found.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (BigInt(b.usageId) > BigInt(a.usageId) ? 1 : -1));
      }
      const items = found.slice(0, query.limit).map(row => structuredClone(row));
      return { items, nextCursor: found.length > query.limit ? Buffer.from(JSON.stringify([items.at(-1).createdAt, items.at(-1).usageId])).toString('base64url') : null };
    },
    async getSummary(w, options = {}) { return summarize(await readRows(w, queryOptions(options)), options.groupBy); },
  };
  return store;
}
