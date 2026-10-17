// LLM-provider executor (change: add-llm-agent-flow-task / #640).
//
// First-party BYOK LLM completion plane. Mirrors embedding-executor.mjs: a per-workspace
// provider store that persists ONLY a `secretRef` (never a plaintext key), backend-pluggable
// completion (a deterministic local mock for dev/test, an OpenAI-compatible HTTP backend for
// production providers), model allow-listing, and per-tenant/workspace token-usage metering.
//
// Secret handling matches the embedding executor: the key is resolved at REQUEST time via an
// injected `secretResolver(secretRef)` (ESO/Vault mounts the value as the env var named by
// `secretRef.name`); resolution is never cached, so key rotation is picked up immediately, and
// a null/absent secret fails CLOSED (no unauthenticated provider call is ever made).
//
// BYOK confinement (fix-byok-secretref-endpoint-confinement / #659): the secretRef name is
// confined to an operator-controlled reserved prefix allow-list and the endpoint is validated
// against an SSRF guard — at config-deploy time (reject 400, no DB write) AND re-validated at
// request time (fail-closed for any pre-existing malicious row). The DEFAULT secretResolver is
// the confined resolver, so a non-allow-listed env var is NEVER read.
import { clientError } from './errors.mjs';
import { resolveLlmAdapter } from './llm-adapters/registry.mjs';
import { createLlmTransport } from './llm-adapters/transport.mjs';
import { normalizeUsage, normalizeFinishReason, adapterError } from './llm-adapters/contract.mjs';
import {
  assertSecretRefAllowed,
  assertEndpointAllowed,
  isAllowedSecretName,
  createConfinedSecretResolver,
  parseAllowedSecretPrefixes,
} from './byok-provider-guard.mjs';

// Tenant sentinel for the rare caller that does not pass `tenantId` (the HTTP route always
// injects the verified identity's tenantId). The (tenant_id, workspace_id) key is NOT NULL, so a
// sentinel keeps single-tenant/test callers working without a NULL key.
const TENANT_SENTINEL = '_';

// ---------------------------------------------------------------------------
// Backends — `{ complete({ endpoint, apiKey, model, messages, maxTokens, temperature }) }`
// returns `{ content, usage }`; `stream(...)` is an async generator yielding
// `{ type: 'delta', content }` frames and a terminal `{ type: 'usage', usage }` frame.
// ---------------------------------------------------------------------------

// Deterministic mock backend: echoes a fixed completion and stable token counts so tests are
// reproducible (no external provider call). The completion text incorporates the last user
// message so a flow author can assert the prompt reached the backend.
export function localMockLlmBackend({ promptTokens = 4, completionTokens = 6 } = {}) {
  const usage = () => ({ promptTokens, completionTokens, totalTokens: promptTokens + completionTokens });
  const contentFor = (messages) => {
    const last = Array.isArray(messages) ? [...messages].reverse().find((m) => m?.role === 'user') : undefined;
    return `mock-completion: ${last?.content ?? ''}`.trim();
  };
  return {
    providerType: 'mock',
    async complete({ messages }) {
      return { content: contentFor(messages), usage: usage() };
    },
    async *stream({ messages }) {
      const text = contentFor(messages);
      // Two deterministic delta frames, then the terminal usage frame.
      const mid = Math.ceil(text.length / 2);
      yield { type: 'delta', content: text.slice(0, mid) };
      yield { type: 'delta', content: text.slice(mid) };
      yield { type: 'usage', usage: usage() };
    },
  };
}

// HTTP backend: posts to an OpenAI-compatible `/chat/completions` endpoint with the resolved key.
// `endpoint` and `apiKey` are supplied PER CALL by the executor (which resolves the secret), so the
// backend itself is stateless and holds no credential. fetchImpl is injectable for tests.
export function httpLlmBackend({ providerType, fetchImpl } = {}) {
  return { providerType, ...createLlmTransport({ adapter: resolveLlmAdapter(providerType), fetchImpl }) };
}

// Build the message array the provider sees. An explicit `messages` array wins; otherwise a
// `system`/`prompt` pair is the ergonomic shorthand the flow designer surfaces.
function normalizeMessages({ messages, prompt, system } = {}) {
  if (Array.isArray(messages) && messages.length > 0) return messages;
  const out = [];
  if (system) out.push({ role: 'system', content: String(system) });
  if (prompt) out.push({ role: 'user', content: String(prompt) });
  return out;
}

// ---------------------------------------------------------------------------
// Provider store — persists ONLY the secretRef (never a resolved key). Tenant-scoped by
// (tenant_id, workspace_id). With no `pool` it is an in-memory Map (test seam / single-process
// fallback); with a `pool` it persists to `workspace_llm_connections` on the metadata DB.
// ---------------------------------------------------------------------------
export function createLlmProviderStore({ pool } = {}) {
  if (!pool) return createInMemoryProviderStore();
  return createPostgresProviderStore(pool);
}

function providerKey(tenantId, workspaceId) {
  return JSON.stringify([tenantId ?? TENANT_SENTINEL, workspaceId]);
}

// Strip any plaintext secret a caller may have (mis)passed; persist only secretRef + config.
function sanitizeProviderConfig(config = {}) {
  const { apiKey, secret, key, tenantId, ...safe } = config;
  return {
    providerType: safe.providerType,
    endpoint: safe.endpoint,
    allowedModels: Array.isArray(safe.allowedModels) ? safe.allowedModels.map(String) : [],
    defaultModel: safe.defaultModel,
    secretRef: safe.secretRef,
  };
}

function validateConnection(config, connectionId) {
  if (typeof connectionId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(connectionId)) {
    throw clientError('Invalid connection identifier', 400, 'INVALID_CONNECTION_ID');
  }
  if (config.displayName != null && (typeof config.displayName !== 'string' || config.displayName.length > 128)) {
    throw clientError('displayName must be at most 128 characters', 400, 'INVALID_DISPLAY_NAME');
  }
}

function connectionRecord(workspaceId, config, connectionId, existing, isDefault) {
  validateConnection(config, connectionId);
  return {
    ...sanitizeProviderConfig(config),
    tenantId: config.tenantId ?? TENANT_SENTINEL, workspaceId, connectionId,
    displayName: config.displayName ?? null, isDefault,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createInMemoryProviderStore() {
  const workspaces = new Map();
  const records = (workspaceId, tenantId) => workspaces.get(providerKey(tenantId, workspaceId)) ?? [];
  const copy = value => structuredClone(value);
  const store = {
    async ensureSchema() {},
    async listConnections(workspaceId, tenantId) { return copy(records(workspaceId, tenantId).slice().sort((a, b) => (a.connectionId < b.connectionId ? -1 : a.connectionId > b.connectionId ? 1 : 0))); },
    async getConnection(workspaceId, connectionId, tenantId) {
      const record = records(workspaceId, tenantId).find(r => r.connectionId === connectionId);
      if (!record) throw clientError('LLM connection not found', 404, 'LLM_CONNECTION_NOT_FOUND');
      return copy(record);
    },
    async createConnection(workspaceId, config = {}) {
      if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING');
      const rows = records(workspaceId, config.tenantId);
      validateConnection(config, config.connectionId);
      if (rows.some(r => r.connectionId === config.connectionId)) throw clientError('LLM connection exists', 409, 'LLM_CONNECTION_EXISTS');
      if (rows.length >= 32) throw clientError('LLM connection limit reached', 409, 'LLM_CONNECTION_LIMIT_REACHED');
      const record = connectionRecord(workspaceId, config, config.connectionId, null, rows.length === 0 || config.isDefault === true);
      if (record.isDefault) rows.forEach(r => { r.isDefault = false; });
      workspaces.set(providerKey(config.tenantId, workspaceId), [...rows, copy(record)]);
      return copy(record);
    },
    async replaceConnection(workspaceId, connectionId, config = {}) {
      const rows = records(workspaceId, config.tenantId);
      const existing = rows.find(r => r.connectionId === connectionId);
      if (!existing) throw clientError('LLM connection not found', 404, 'LLM_CONNECTION_NOT_FOUND');
      if (existing.isDefault && config.isDefault === false) throw clientError('A default connection is required', 409, 'LLM_DEFAULT_REQUIRED');
      const record = connectionRecord(workspaceId, config, connectionId, existing, existing.isDefault || config.isDefault === true);
      if (record.isDefault) rows.forEach(r => { r.isDefault = false; });
      rows[rows.indexOf(existing)] = copy(record);
      return copy(record);
    },
    async deleteConnection(workspaceId, connectionId, tenantId) {
      const rows = records(workspaceId, tenantId);
      if (!rows.some(r => r.connectionId === connectionId)) throw clientError('LLM connection not found', 404, 'LLM_CONNECTION_NOT_FOUND');
      workspaces.set(providerKey(tenantId, workspaceId), rows.filter(r => r.connectionId !== connectionId));
      return { removed: true };
    },
    async deployProvider(workspaceId, config = {}) {
      const rows = records(workspaceId, config.tenantId);
      const current = rows.find(r => r.isDefault) ?? rows.find(r => r.connectionId === 'default');
      if (!current) return store.createConnection(workspaceId, { ...config, connectionId: 'default', isDefault: true });
      const displayName = config.displayName === undefined ? current.displayName : config.displayName;
      const record = connectionRecord(workspaceId, { ...config, displayName }, current.connectionId, current, true);
      rows[rows.indexOf(current)] = copy(record);
      return copy(record);
    },
    async getProvider(workspaceId, tenantId) { return copy(records(workspaceId, tenantId).find(r => r.isDefault) ?? null); },
    async removeProvider(workspaceId, tenantId) {
      const rows = records(workspaceId, tenantId);
      const remaining = rows.filter(r => !r.isDefault);
      workspaces.set(providerKey(tenantId, workspaceId), remaining);
      return { removed: remaining.length !== rows.length };
    },
  };
  return store;
}

function createPostgresProviderStore(pool) {
  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.message === 'LLM_CONNECTION_LIMIT_REACHED') throw clientError('LLM connection limit reached', 409, 'LLM_CONNECTION_LIMIT_REACHED');
      throw error;
    } finally { client.release(); }
  }

  async function ensureSchema() {
    await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('workspace_llm_connections'))");
      // Keep the old table and its unique key for rolling updates and rollbacks.
      await client.query(`CREATE TABLE IF NOT EXISTS workspace_llm_providers (
        tenant_id text NOT NULL, workspace_id text NOT NULL, provider_type text, endpoint text,
        allowed_models jsonb NOT NULL DEFAULT '[]'::jsonb, default_model text, secret_ref jsonb,
        updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, workspace_id)
      )`);
      await client.query('LOCK TABLE workspace_llm_providers IN SHARE ROW EXCLUSIVE MODE');
      await client.query('CREATE INDEX IF NOT EXISTS idx_wlp_workspace ON workspace_llm_providers (workspace_id)');
      await client.query('ALTER TABLE workspace_llm_providers ADD COLUMN IF NOT EXISTS migrated_at timestamptz');
      await client.query(`CREATE TABLE IF NOT EXISTS workspace_llm_connections (
        tenant_id text NOT NULL, workspace_id text NOT NULL,
        connection_id text NOT NULL CHECK (connection_id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
        display_name text, provider_type text, endpoint text,
        allowed_models jsonb NOT NULL DEFAULT '[]'::jsonb, default_model text, secret_ref jsonb,
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, workspace_id, connection_id)
      )`);
      await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_wlc_default ON workspace_llm_connections (tenant_id, workspace_id) WHERE is_default');
      await client.query('CREATE INDEX IF NOT EXISTS idx_wlc_workspace ON workspace_llm_connections (workspace_id)');
      await client.query(`INSERT INTO workspace_llm_connections
        (tenant_id, workspace_id, connection_id, provider_type, endpoint, allowed_models, default_model, secret_ref, is_default, created_at, updated_at)
        SELECT tenant_id, workspace_id, 'default', provider_type, endpoint, allowed_models, default_model, secret_ref, true, updated_at, updated_at
        FROM workspace_llm_providers WHERE migrated_at IS NULL ON CONFLICT DO NOTHING`);
      await client.query('UPDATE workspace_llm_providers SET migrated_at = now() WHERE migrated_at IS NULL');
      // All writers share the same workspace lock. Updates at capacity remain legal.
      await client.query(`CREATE OR REPLACE FUNCTION enforce_llm_connection_limit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('workspace_llm_connections'), hashtext(json_build_array(NEW.tenant_id, NEW.workspace_id)::text));
        IF NOT EXISTS (SELECT 1 FROM workspace_llm_connections WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id AND connection_id=NEW.connection_id)
          AND (SELECT count(*) FROM workspace_llm_connections WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id) >= 32 THEN
          RAISE EXCEPTION 'LLM_CONNECTION_LIMIT_REACHED';
        END IF;
        RETURN NEW;
      END; $$`);
      await client.query(`CREATE OR REPLACE TRIGGER workspace_llm_connections_limit
        BEFORE INSERT ON workspace_llm_connections FOR EACH ROW EXECUTE FUNCTION enforce_llm_connection_limit()`);
      await client.query(`CREATE OR REPLACE FUNCTION mirror_legacy_llm_provider() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          PERFORM pg_advisory_xact_lock(hashtext('workspace_llm_connections'), hashtext(json_build_array(OLD.tenant_id, OLD.workspace_id)::text));
          DELETE FROM workspace_llm_connections WHERE tenant_id=OLD.tenant_id AND workspace_id=OLD.workspace_id AND is_default;
          RETURN OLD;
        END IF;
        IF TG_OP = 'UPDATE' THEN
          IF ROW(NEW.provider_type, NEW.endpoint, NEW.allowed_models, NEW.default_model, NEW.secret_ref)
            IS NOT DISTINCT FROM ROW(OLD.provider_type, OLD.endpoint, OLD.allowed_models, OLD.default_model, OLD.secret_ref) THEN
            RETURN NEW;
          END IF;
        END IF;
        PERFORM pg_advisory_xact_lock(hashtext('workspace_llm_connections'), hashtext(json_build_array(NEW.tenant_id, NEW.workspace_id)::text));
        UPDATE workspace_llm_connections SET
          provider_type=NEW.provider_type, endpoint=NEW.endpoint, allowed_models=NEW.allowed_models,
          default_model=NEW.default_model, secret_ref=NEW.secret_ref, updated_at=NEW.updated_at
          WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id AND is_default;
        IF NOT FOUND THEN
          UPDATE workspace_llm_connections SET
            provider_type=NEW.provider_type, endpoint=NEW.endpoint, allowed_models=NEW.allowed_models,
            default_model=NEW.default_model, secret_ref=NEW.secret_ref, updated_at=NEW.updated_at, is_default=true
            WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id AND connection_id='default';
          IF NOT FOUND THEN
            IF (SELECT count(*) FROM workspace_llm_connections WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id) >= 32 THEN
              RAISE EXCEPTION 'LLM_CONNECTION_LIMIT_REACHED';
            END IF;
            INSERT INTO workspace_llm_connections
              (tenant_id, workspace_id, connection_id, provider_type, endpoint, allowed_models, default_model, secret_ref, is_default, created_at, updated_at)
              VALUES (NEW.tenant_id, NEW.workspace_id, 'default', NEW.provider_type, NEW.endpoint, NEW.allowed_models, NEW.default_model, NEW.secret_ref, true, NEW.updated_at, NEW.updated_at);
          END IF;
        END IF;
        NEW.migrated_at = now();
        RETURN NEW;
      END; $$`);
      await client.query(`CREATE OR REPLACE TRIGGER workspace_llm_providers_mirror
        BEFORE INSERT OR UPDATE OR DELETE ON workspace_llm_providers FOR EACH ROW EXECUTE FUNCTION mirror_legacy_llm_provider()`);
    });
  }

  function rowToRecord(row) {
    if (!row) return null;
    const timestamp = value => value instanceof Date ? value.toISOString() : value;
    return {
      tenantId: row.tenant_id, workspaceId: row.workspace_id,
      connectionId: row.connection_id ?? 'default', displayName: row.display_name ?? null,
      isDefault: row.is_default ?? true, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
      providerType: row.provider_type ?? undefined, endpoint: row.endpoint ?? undefined,
      allowedModels: Array.isArray(row.allowed_models) ? row.allowed_models : [],
      defaultModel: row.default_model ?? undefined, secretRef: row.secret_ref ?? undefined,
    };
  }

  async function lockWorkspace(client, tenant, workspaceId) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('workspace_llm_connections'), hashtext(json_build_array($1::text, $2::text)::text))", [tenant, workspaceId]);
  }

  async function writeConnection(workspaceId, connectionId, config, mode) {
    if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING');
    if (mode !== 'replace') validateConnection(config, connectionId);
    const tenant = config.tenantId ?? TENANT_SENTINEL;
    const safe = sanitizeProviderConfig(config);
    return transaction(async client => {
      await lockWorkspace(client, tenant, workspaceId);
      const { rows } = await client.query('SELECT * FROM workspace_llm_connections WHERE tenant_id=$1 AND workspace_id=$2', [tenant, workspaceId]);
      let existing = rows.find(r => r.connection_id === connectionId);
      if (mode === 'default') {
        existing = rows.find(r => r.is_default) ?? existing;
        connectionId = existing?.connection_id ?? 'default';
      }
      if (mode === 'create' && existing) throw clientError('LLM connection exists', 409, 'LLM_CONNECTION_EXISTS');
      if (mode === 'replace' && !existing) throw clientError('LLM connection not found', 404, 'LLM_CONNECTION_NOT_FOUND');
      if (mode === 'replace') validateConnection(config, connectionId);
      if (!existing && rows.length >= 32) throw clientError('LLM connection limit reached', 409, 'LLM_CONNECTION_LIMIT_REACHED');
      if (mode === 'replace' && existing.is_default && config.isDefault === false) throw clientError('A default connection is required', 409, 'LLM_DEFAULT_REQUIRED');
      const isDefault = mode === 'default' || config.isDefault === true || (existing ? existing.is_default : rows.length === 0);
      if (isDefault) await client.query('UPDATE workspace_llm_connections SET is_default=false WHERE tenant_id=$1 AND workspace_id=$2 AND is_default AND connection_id<>$3', [tenant, workspaceId, connectionId]);
      const displayName = mode === 'default' && config.displayName === undefined ? existing?.display_name : config.displayName;
      const values = [tenant, workspaceId, connectionId, displayName ?? null, safe.providerType ?? null, safe.endpoint ?? null,
        JSON.stringify(safe.allowedModels), safe.defaultModel ?? null, safe.secretRef === undefined ? null : JSON.stringify(safe.secretRef), isDefault];
      const result = existing
        ? await client.query(`UPDATE workspace_llm_connections SET display_name=$4, provider_type=$5, endpoint=$6,
            allowed_models=$7::jsonb, default_model=$8, secret_ref=$9::jsonb, is_default=$10, updated_at=now()
            WHERE tenant_id=$1 AND workspace_id=$2 AND connection_id=$3 RETURNING *`, values)
        : await client.query(`INSERT INTO workspace_llm_connections
            (tenant_id, workspace_id, connection_id, display_name, provider_type, endpoint, allowed_models, default_model, secret_ref, is_default)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10) RETURNING *`, values);
      return rowToRecord(result.rows[0]);
    });
  }

  return {
    pool, ensureSchema,
    async listConnections(workspaceId, tenantId) {
      const result = await pool.query('SELECT * FROM workspace_llm_connections WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY connection_id COLLATE "C"', [tenantId ?? TENANT_SENTINEL, workspaceId]);
      return result.rows.map(rowToRecord);
    },
    async getConnection(workspaceId, connectionId, tenantId) {
      const result = await pool.query('SELECT * FROM workspace_llm_connections WHERE tenant_id=$1 AND workspace_id=$2 AND connection_id=$3', [tenantId ?? TENANT_SENTINEL, workspaceId, connectionId]);
      if (!result.rows[0]) throw clientError('LLM connection not found', 404, 'LLM_CONNECTION_NOT_FOUND');
      return rowToRecord(result.rows[0]);
    },
    createConnection: (workspaceId, config = {}) => writeConnection(workspaceId, config.connectionId, config, 'create'),
    replaceConnection: (workspaceId, connectionId, config = {}) => writeConnection(workspaceId, connectionId, config, 'replace'),
    deployProvider: (workspaceId, config = {}) => writeConnection(workspaceId, 'default', config, 'default'),
    async deleteConnection(workspaceId, connectionId, tenantId) {
      return transaction(async client => {
        await lockWorkspace(client, tenantId ?? TENANT_SENTINEL, workspaceId);
        const result = await client.query('DELETE FROM workspace_llm_connections WHERE tenant_id=$1 AND workspace_id=$2 AND connection_id=$3 RETURNING connection_id', [tenantId ?? TENANT_SENTINEL, workspaceId, connectionId]);
        if (!result.rowCount) throw clientError('LLM connection not found', 404, 'LLM_CONNECTION_NOT_FOUND');
        return { removed: true };
      });
    },
    async getProvider(workspaceId, tenantId) {
      let res;
      try {
        res = tenantId
          ? await pool.query('SELECT * FROM workspace_llm_connections WHERE tenant_id = $1 AND workspace_id = $2 AND is_default', [tenantId, workspaceId])
          : await pool.query('SELECT * FROM workspace_llm_connections WHERE workspace_id = $1 AND is_default LIMIT 1', [workspaceId]);
      } catch (error) {
        // Workers do not own schema setup. Only a missing registry permits the pre-upgrade read.
        if (error.code !== '42P01') throw error;
        res = tenantId
          ? await pool.query('SELECT * FROM workspace_llm_providers WHERE tenant_id = $1 AND workspace_id = $2 LIMIT 1', [tenantId, workspaceId])
          : await pool.query('SELECT * FROM workspace_llm_providers WHERE workspace_id = $1 LIMIT 1', [workspaceId]);
      }
      return rowToRecord(res.rows[0]);
    },
    async removeProvider(workspaceId, tenantId) {
      return transaction(async client => {
        if (tenantId) await lockWorkspace(client, tenantId, workspaceId);
        const res = tenantId
          ? await client.query('DELETE FROM workspace_llm_connections WHERE tenant_id = $1 AND workspace_id = $2 AND is_default RETURNING workspace_id', [tenantId, workspaceId])
          : await client.query('DELETE FROM workspace_llm_connections WHERE workspace_id = $1 AND is_default RETURNING workspace_id', [workspaceId]);
        return { removed: res.rowCount > 0 };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Usage store — append-only token-usage log, tenant-scoped by (tenant_id, workspace_id). The
// rollup is grouped by model and NEVER aggregates across tenants. In-memory with no `pool`.
// ---------------------------------------------------------------------------
export function createLlmUsageStore({ pool } = {}) {
  if (!pool) return createInMemoryUsageStore();
  return createPostgresUsageStore(pool);
}

function rollupRows(rows) {
  const byModel = new Map();
  for (const r of rows) {
    const key = r.model ?? '';
    const acc = byModel.get(key) ?? { model: r.model ?? null, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    acc.promptTokens += Number(r.promptTokens) || 0;
    acc.completionTokens += Number(r.completionTokens) || 0;
    acc.totalTokens += Number(r.totalTokens) || 0;
    byModel.set(key, acc);
  }
  return [...byModel.values()].sort((a, b) => String(a.model).localeCompare(String(b.model)));
}

function createInMemoryUsageStore() {
  const rows = [];
  return {
    async ensureSchema() {},
    async recordUsage(workspaceId, { tenantId, model, promptTokens, completionTokens, totalTokens } = {}) {
      rows.push({
        tenantId: tenantId ?? TENANT_SENTINEL,
        workspaceId,
        model: model ?? null,
        promptTokens: Number(promptTokens) || 0,
        completionTokens: Number(completionTokens) || 0,
        totalTokens: Number(totalTokens) || 0,
        createdAt: new Date().toISOString(),
      });
    },
    async getRollup(workspaceId, tenantId) {
      const tenant = tenantId ?? TENANT_SENTINEL;
      const scoped = rows.filter((r) => r.workspaceId === workspaceId && r.tenantId === tenant);
      return { items: rollupRows(scoped) };
    },
  };
}

function createPostgresUsageStore(pool) {
  async function ensureSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS workspace_llm_usage (
      tenant_id         text NOT NULL,
      workspace_id      text NOT NULL,
      model             text,
      prompt_tokens     integer NOT NULL DEFAULT 0,
      completion_tokens integer NOT NULL DEFAULT 0,
      total_tokens      integer NOT NULL DEFAULT 0,
      created_at        timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_wlu_scope ON workspace_llm_usage (tenant_id, workspace_id)');
  }
  return {
    pool,
    ensureSchema,
    async recordUsage(workspaceId, { tenantId, model, promptTokens, completionTokens, totalTokens } = {}) {
      await pool.query(
        `INSERT INTO workspace_llm_usage (tenant_id, workspace_id, model, prompt_tokens, completion_tokens, total_tokens, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())`,
        [tenantId ?? TENANT_SENTINEL, workspaceId, model ?? null, Number(promptTokens) || 0, Number(completionTokens) || 0, Number(totalTokens) || 0],
      );
    },
    async getRollup(workspaceId, tenantId) {
      // Scoped to (tenant_id, workspace_id); SUM by model so usage NEVER aggregates across tenants.
      const res = await pool.query(
        `SELECT model,
                SUM(prompt_tokens)::bigint     AS prompt_tokens,
                SUM(completion_tokens)::bigint AS completion_tokens,
                SUM(total_tokens)::bigint      AS total_tokens
           FROM workspace_llm_usage
          WHERE tenant_id = $1 AND workspace_id = $2
          GROUP BY model
          ORDER BY model`,
        [tenantId ?? TENANT_SENTINEL, workspaceId],
      );
      return {
        items: res.rows.map((r) => ({
          model: r.model ?? null,
          promptTokens: Number(r.prompt_tokens) || 0,
          completionTokens: Number(r.completion_tokens) || 0,
          totalTokens: Number(r.total_tokens) || 0,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Executor — ties the provider store, secret resolution, the backend, allow-listing, and metering
// together. secretResolver(secretRef) bridges to Vault/ESO; backendFactory is the test seam.
// ---------------------------------------------------------------------------
export function createLlmExecutor(options = {}) {
  const providerStore = options.providerStore ?? createLlmProviderStore();
  const usageStore = options.usageStore ?? createLlmUsageStore();
  const backendFactory = options.backendFactory; // (config) -> backend (test seam)
  const fetchImpl = options.fetchImpl;

  // BYOK confinement config (#659). `prefixes` is the reserved secret-name allow-list; `guardEnv`
  // is the env consulted by the confined resolver / endpoint host allow-list (injectable in tests).
  // `endpointResolver` is the injectable DNS resolver for the SSRF guard (default lives in the
  // guard module). When SSRF guarding must be disabled for a test seam, pass `enforceEndpointGuard:
  // false` — production NEVER sets it (defaults to enforced).
  const guardEnv = options.guardEnv ?? process.env;
  const prefixes = options.secretPrefixes ?? parseAllowedSecretPrefixes(guardEnv);
  const endpointResolver = options.endpointResolver; // (hostname) -> Promise<string[]> (test seam)
  const enforceEndpointGuard = options.enforceEndpointGuard !== false;
  // DEFAULT to a confined resolver so a non-allow-listed env var is NEVER read; an explicit
  // resolver (tests) is still honored but is additionally gated by isAllowedSecretName below.
  const secretResolver = options.secretResolver ?? createConfinedSecretResolver({ env: guardEnv, prefixes });

  const endpointGuardOpts = { env: guardEnv, ...(endpointResolver ? { resolver: endpointResolver } : {}) };
  // Validate a configured endpoint; a nullish endpoint is a no-op (a mock/local backend makes no
  // outbound call, so there is no SSRF surface to guard — the SSRF risk is only the dialed URL).
  async function assertEndpoint(endpoint) {
    if (enforceEndpointGuard && endpoint != null && endpoint !== '') await assertEndpointAllowed(endpoint, endpointGuardOpts);
  }

  async function resolveProviderOrThrow(workspaceId, tenantId) {
    const config = await providerStore.getProvider(workspaceId, tenantId);
    if (!config) throw clientError('No LLM provider configured for this workspace', 422, 'LLM_PROVIDER_MISSING');
    return config;
  }

  // Pick the effective model and enforce the allow-list BEFORE any provider call. An empty
  // allow-list is treated as "no model permitted" so a misconfigured provider fails closed.
  function resolveAllowedModel(config, model) {
    const allowed = Array.isArray(config.allowedModels) ? config.allowedModels : [];
    const chosen = model ?? config.defaultModel;
    if (!chosen || allowed.length === 0 || !allowed.includes(chosen)) {
      throw clientError(`Model "${chosen ?? ''}" is not in the workspace allow-list`, 422, 'MODEL_NOT_ALLOWED');
    }
    return chosen;
  }

  // Resolve the BYOK key at request time (no caching); a null secret fails CLOSED. The
  // secretRef name is RE-CHECKED against the allow-list here (#659) so a pre-existing malicious
  // row (persisted before this guard shipped) can never resolve an arbitrary env var, regardless
  // of which resolver is injected.
  async function resolveSecretOrThrow(config) {
    if (config?.secretRef?.name !== undefined && !isAllowedSecretName(config.secretRef.name, prefixes)) {
      throw clientError('LLM provider secret could not be resolved', 500, 'LLM_PROVIDER_SECRET_UNRESOLVED');
    }
    const apiKey = secretResolver ? await secretResolver(config.secretRef) : null;
    if (!apiKey) throw clientError('LLM provider secret could not be resolved', 500, 'LLM_PROVIDER_SECRET_UNRESOLVED');
    return apiKey;
  }

  function backendFor(config) {
    if (backendFactory) return backendFactory(config);
    return httpLlmBackend({ providerType: config.providerType, fetchImpl });
  }

  async function prepare(workspaceId, { tenantId, model } = {}) {
    const config = await resolveProviderOrThrow(workspaceId, tenantId);
    const chosen = resolveAllowedModel(config, model);
    // Re-validate the endpoint just before the outbound call (DNS-rebinding defense + fail-closed
    // for any malicious row persisted before this guard shipped).
    await assertEndpoint(config.endpoint);
    const apiKey = await resolveSecretOrThrow(config);
    return { config, chosen, apiKey, backend: backendFor(config) };
  }

  // Config-deploy: confine the secretRef + SSRF-validate the endpoint BEFORE persisting, so a
  // rejected config (400) writes NO row. The store still strips any mis-passed plaintext key.
  async function setProvider(workspaceId, config = {}) {
    assertSecretRefAllowed(config.secretRef, prefixes);
    if (config.endpoint !== undefined) await assertEndpoint(config.endpoint);
    return providerStore.deployProvider(workspaceId, config);
  }

  async function complete(workspaceId, { tenantId, model, messages, prompt, system, maxTokens, temperature } = {}) {
    const { config, chosen, apiKey, backend } = await prepare(workspaceId, { tenantId, model });
    const built = normalizeMessages({ messages, prompt, system });
    const out = await backend.complete({ endpoint: config.endpoint, apiKey, model: chosen, messages: built, maxTokens, temperature });
    const usage = normalizeUsage(out.usage);
    await usageStore.recordUsage(workspaceId, { tenantId, model: chosen, ...usage });
    return { content: out.content ?? '', usage, model: out.model ?? chosen, finishReason: normalizeFinishReason(out.finishReason) };
  }

  // Streaming variant: yields `{ type:'delta', content }` frames, records usage when the terminal
  // usage frame arrives, then yields a final `{ type:'usage', usage }` frame.
  async function* completeStream(workspaceId, { tenantId, model, messages, prompt, system, maxTokens, temperature } = {}) {
    const { config, chosen, apiKey, backend } = await prepare(workspaceId, { tenantId, model });
    const built = normalizeMessages({ messages, prompt, system });
    for await (const frame of backend.stream({ endpoint: config.endpoint, apiKey, model: chosen, messages: built, maxTokens, temperature })) {
      if (frame?.type === 'error') {
        yield { type: 'error', code: frame.code };
        return;
      }
      if (frame?.type === 'usage') {
        const usage = normalizeUsage(frame.usage);
        await usageStore.recordUsage(workspaceId, { tenantId, model: chosen, ...usage });
        yield { type: 'usage', usage, model: frame.model ?? chosen, finishReason: normalizeFinishReason(frame.finishReason) };
        return;
      }
      yield { type: 'delta', content: frame?.content ?? '' };
    }
    throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  }

  async function getUsage(workspaceId, { tenantId } = {}) {
    return usageStore.getRollup(workspaceId, tenantId);
  }

  async function ensureSchema() {
    await providerStore.ensureSchema?.();
    await usageStore.ensureSchema?.();
  }

  return {
    providerStore,
    usageStore,
    // Config-plane convenience wrappers (the HTTP routes call these). setProvider confines the
    // secretRef + SSRF-validates the endpoint before persisting (#659).
    setProvider,
    async createConnection(workspaceId, config = {}) {
      assertSecretRefAllowed(config.secretRef, prefixes);
      await assertEndpoint(config.endpoint);
      return providerStore.createConnection(workspaceId, config);
    },
    async replaceConnection(workspaceId, connectionId, config = {}) {
      assertSecretRefAllowed(config.secretRef, prefixes);
      await assertEndpoint(config.endpoint);
      return providerStore.replaceConnection(workspaceId, connectionId, config);
    },
    deleteConnection: (workspaceId, connectionId, tenantId) => providerStore.deleteConnection(workspaceId, connectionId, tenantId),
    listConnections: (workspaceId, tenantId) => providerStore.listConnections(workspaceId, tenantId),
    getConnection: (workspaceId, connectionId, tenantId) => providerStore.getConnection(workspaceId, connectionId, tenantId),
    getProvider: (workspaceId, tenantId) => providerStore.getProvider(workspaceId, tenantId),
    removeProvider: (workspaceId, tenantId) => providerStore.removeProvider(workspaceId, tenantId),
    complete,
    completeStream,
    getUsage,
    ensureSchema,
  };
}
