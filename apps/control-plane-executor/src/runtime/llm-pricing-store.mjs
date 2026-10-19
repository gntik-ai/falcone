import { randomUUID } from 'node:crypto';
import { clientError } from './errors.mjs';
import platformCatalog from './llm-adapters/price-catalog.mjs';
import { validModelId } from './llm-adapters/connection-models.mjs';

const rates = ['input_micros_per_mtok', 'output_micros_per_mtok', 'cache_read_micros_per_mtok', 'cache_write_micros_per_mtok'];
const scope = (w, t) => [t ?? '_', w];
const key = entry => JSON.stringify([entry.providerType, entry.model, entry.mode]);
const currencyError = () => clientError('Ledger currency is locked', 409, 'LLM_CURRENCY_LOCKED');
function validateCurrency(currency) {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw clientError('Invalid currency', 400, 'INVALID_LLM_CURRENCY');
}
function validateEntries(entries) {
  const seen = new Set();
  if (!Array.isArray(entries) || entries.length > 1000) throw clientError('Invalid price list', 400, 'INVALID_LLM_PRICES');
  return entries.map(entry => {
    if (!entry || typeof entry.providerType !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.providerType)
      || !validModelId(entry.model) || !['sync', 'batch'].includes(entry.mode) || seen.has(key(entry))
      || !rates.every((rate, i) => i >= 2 && entry[rate] == null || Number.isSafeInteger(entry[rate]) && entry[rate] >= 0)) {
      throw clientError('Invalid price entry', 400, 'INVALID_LLM_PRICES');
    }
    seen.add(key(entry));
    return { providerType: entry.providerType, model: entry.model, mode: entry.mode,
      ...Object.fromEntries(rates.map(rate => [rate, entry[rate] ?? null])) };
  });
}

export function costMicros(usage, price, estimate = false) {
  const input = BigInt(usage.promptTokens ?? 0), output = BigInt(usage.completionTokens ?? 0);
  const read = BigInt(usage.cacheReadTokens ?? 0), write = BigInt(usage.cacheWriteTokens ?? 0);
  const uncached = input > read + write ? input - read - write : 0n;
  const numerator = uncached * BigInt(price.input_micros_per_mtok) + output * BigInt(price.output_micros_per_mtok)
    + read * BigInt(price.cache_read_micros_per_mtok ?? price.input_micros_per_mtok)
    + write * BigInt(price.cache_write_micros_per_mtok ?? price.input_micros_per_mtok);
  return String((numerator + (estimate ? 999999n : 500000n)) / 1000000n);
}

export function createLlmPricingStore({ pool, now = Date.now, priceCatalog = platformCatalog } = {}) {
  const settings = new Map(), lists = new Map(), budgets = new Map();
  const mapKey = (w, t) => JSON.stringify(scope(w, t));
  async function transaction(fn, client = pool) {
    if (!pool || client !== pool) return fn(client);
    const conn = await pool.connect();
    try { await conn.query('BEGIN'); const result = await fn(conn); await conn.query('COMMIT'); return result; }
    catch (error) { await conn.query('ROLLBACK'); throw error; }
    finally { conn.release(); }
  }
  async function getCurrency(w, t, client = pool) {
    if (!pool) return settings.get(mapKey(w, t)) ?? null;
    return (await client.query('SELECT currency FROM workspace_llm_ledger_settings WHERE tenant_id=$1 AND workspace_id=$2', scope(w, t))).rows[0]?.currency ?? null;
  }
  async function lockCurrency(w, t, currency, client = pool, strict = true) {
    validateCurrency(currency);
    if (!pool) {
      const existing = settings.get(mapKey(w, t));
      if (existing && existing !== currency) { if (strict) throw currencyError(); return false; }
      settings.set(mapKey(w, t), currency);
      return true;
    }
    await client.query('INSERT INTO workspace_llm_ledger_settings (tenant_id,workspace_id,currency) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [...scope(w, t), currency]);
    const res = await client.query('SELECT currency FROM workspace_llm_ledger_settings WHERE tenant_id=$1 AND workspace_id=$2 FOR UPDATE', scope(w, t));
    if (res.rows[0].currency !== currency) { if (strict) throw currencyError(); return false; }
    return true;
  }
  async function activeList(w, t, client = pool) {
    if (!pool) return structuredClone(lists.get(mapKey(w, t))?.at(-1) ?? null);
    const res = await client.query('SELECT * FROM workspace_llm_price_lists WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY list_sequence DESC LIMIT 1', scope(w, t));
    const row = res.rows[0];
    if (!row) return null;
    const prices = await client.query('SELECT * FROM workspace_llm_prices WHERE tenant_id=$1 AND workspace_id=$2 AND price_list_id=$3 ORDER BY provider_type,model,mode', [...scope(w, t), row.price_list_id]);
    return { priceListId: row.price_list_id, currency: row.currency, createdAt: new Date(row.created_at).toISOString(), entries: prices.rows.map(entry => ({
      providerType: entry.provider_type, model: entry.model, mode: entry.mode,
      ...Object.fromEntries(rates.map(rate => [rate, entry[rate] == null ? null : Number(entry[rate])])),
    })) };
  }
  const store = {
    transaction, getCurrency, lockCurrency,
    async ensureSchema() {
      if (!pool) return;
      await pool.query(`CREATE TABLE IF NOT EXISTS workspace_llm_ledger_settings (
        tenant_id text NOT NULL, workspace_id text NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), PRIMARY KEY (tenant_id,workspace_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS workspace_llm_budgets (
        tenant_id text NOT NULL, workspace_id text NOT NULL, currency text NOT NULL,
        limit_micros bigint NOT NULL CHECK (limit_micros >= 0), period text NOT NULL CHECK (period='month'),
        PRIMARY KEY (tenant_id,workspace_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS workspace_llm_price_lists (
        tenant_id text NOT NULL, workspace_id text NOT NULL, price_list_id uuid NOT NULL, currency text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), list_sequence bigserial,
        PRIMARY KEY (tenant_id,workspace_id,price_list_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS workspace_llm_prices (
        tenant_id text NOT NULL, workspace_id text NOT NULL, price_list_id uuid NOT NULL, provider_type text NOT NULL, model text NOT NULL,
        mode text NOT NULL CHECK (mode IN ('sync','batch')), input_micros_per_mtok bigint NOT NULL CHECK (input_micros_per_mtok >= 0),
        output_micros_per_mtok bigint NOT NULL CHECK (output_micros_per_mtok >= 0), cache_read_micros_per_mtok bigint CHECK (cache_read_micros_per_mtok >= 0),
        cache_write_micros_per_mtok bigint CHECK (cache_write_micros_per_mtok >= 0),
        PRIMARY KEY (tenant_id,workspace_id,price_list_id,provider_type,model,mode),
        FOREIGN KEY (tenant_id,workspace_id,price_list_id) REFERENCES workspace_llm_price_lists (tenant_id,workspace_id,price_list_id)
      )`);
    },
    async getBudget(w, { tenantId } = {}, client = pool) {
      if (!pool) return structuredClone(budgets.get(mapKey(w, tenantId)) ?? null);
      const row = (await client.query('SELECT currency,limit_micros,period FROM workspace_llm_budgets WHERE tenant_id=$1 AND workspace_id=$2', scope(w, tenantId))).rows[0];
      return row ? { currency: row.currency, limitMicros: String(row.limit_micros), period: row.period } : null;
    },
    async putBudget(w, { tenantId, currency, limitMicros, period = 'month' } = {}) {
      validateCurrency(currency);
      if (period !== 'month' || !(typeof limitMicros === 'string' && /^(0|[1-9][0-9]*)$/.test(limitMicros)
        || Number.isSafeInteger(limitMicros) && limitMicros >= 0) || BigInt(limitMicros) > 9223372036854775807n) {
        throw clientError('Invalid monthly budget', 400, 'INVALID_LLM_BUDGET');
      }
      return transaction(async client => {
        await lockCurrency(w, tenantId, currency, client);
        const budget = { currency, limitMicros: String(limitMicros), period };
        if (!pool) budgets.set(mapKey(w, tenantId), budget);
        else await client.query(`INSERT INTO workspace_llm_budgets (tenant_id,workspace_id,currency,limit_micros,period) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (tenant_id,workspace_id) DO UPDATE SET limit_micros=EXCLUDED.limit_micros,period=EXCLUDED.period`, [...scope(w, tenantId), currency, budget.limitMicros, period]);
        return structuredClone(budget);
      });
    },
    async deleteBudget(w, { tenantId } = {}) {
      if (!pool) return { removed: budgets.delete(mapKey(w, tenantId)) };
      return { removed: (await pool.query('DELETE FROM workspace_llm_budgets WHERE tenant_id=$1 AND workspace_id=$2', scope(w, tenantId))).rowCount > 0 };
    },
    async putPrices(w, { tenantId, currency, entries } = {}) {
      validateCurrency(currency);
      const clean = validateEntries(entries);
      return transaction(async client => {
        await lockCurrency(w, tenantId, currency, client);
        const list = { priceListId: randomUUID(), currency, createdAt: new Date(now()).toISOString(), entries: clean };
        if (!pool) { const k = mapKey(w, tenantId); lists.set(k, [...(lists.get(k) ?? []), structuredClone(list)]); }
        else {
          await client.query('INSERT INTO workspace_llm_price_lists (tenant_id,workspace_id,price_list_id,currency,created_at) VALUES ($1,$2,$3,$4,$5)', [...scope(w, tenantId), list.priceListId, currency, list.createdAt]);
          for (const entry of clean) await client.query(`INSERT INTO workspace_llm_prices (tenant_id,workspace_id,price_list_id,provider_type,model,mode,${rates.join(',')}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [...scope(w, tenantId), list.priceListId, entry.providerType, entry.model, entry.mode, ...rates.map(rate => entry[rate])]);
        }
        return list;
      });
    },
    async getPrices(w, { tenantId } = {}) {
      const list = await activeList(w, tenantId);
      const currency = await getCurrency(w, tenantId);
      const effective = new Map();
      if (!currency || currency === priceCatalog.currency) for (const entry of priceCatalog.entries) effective.set(key(entry), { ...entry, source: 'platform', priceCatalogVersion: priceCatalog.catalogVersion });
      for (const entry of list?.entries ?? []) effective.set(key(entry), { ...entry, source: 'workspace', priceListId: list.priceListId });
      return { currency, activeList: list, catalogVersion: priceCatalog.catalogVersion, catalogCurrency: priceCatalog.currency, entries: [...effective.values()] };
    },
    async resolvePrice(w, { tenantId, providerType, model, mode } = {}, client = pool) {
      const list = await activeList(w, tenantId, client);
      const currency = await getCurrency(w, tenantId, client);
      const find = (entries, priceMode) => entries.find(entry => entry.providerType === providerType && entry.model === model && entry.mode === priceMode);
      for (const priceMode of mode === 'batch' ? ['batch', 'sync'] : ['sync']) {
        const workspace = find(list?.entries ?? [], priceMode);
        if (workspace) return { ...workspace, priceSource: 'workspace', priceListId: list.priceListId, priceCatalogVersion: null, currency: list.currency };
        const platform = !currency || currency === priceCatalog.currency ? find(priceCatalog.entries, priceMode) : null;
        if (platform) return { ...platform, priceSource: 'platform', priceListId: null, priceCatalogVersion: priceCatalog.catalogVersion, currency: priceCatalog.currency };
      }
      return null;
    },
  };
  return store;
}
