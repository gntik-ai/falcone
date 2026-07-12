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
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw clientError('httpLlmBackend requires a fetch implementation', 500, 'LLM_CONFIG');
  }
  function bodyFor({ model, messages, maxTokens, temperature, stream }) {
    return {
      model,
      messages,
      ...(maxTokens != null ? { max_tokens: Number(maxTokens) } : {}),
      ...(temperature != null ? { temperature: Number(temperature) } : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  }
  function headers(apiKey) {
    return { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` };
  }
  return {
    providerType,
    async complete({ endpoint, apiKey, model, messages, maxTokens, temperature }) {
      let response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: headers(apiKey),
          body: JSON.stringify(bodyFor({ model, messages, maxTokens, temperature })),
        });
      } catch (error) {
        throw clientError(`LLM provider request failed: ${error.message}`, 502, 'LLM_PROVIDER_ERROR');
      }
      if (!response.ok) {
        throw clientError(`LLM provider returned status ${response.status}`, 502, 'LLM_PROVIDER_ERROR');
      }
      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content ?? '';
      return { content: String(content), usage: normalizeUsage(json?.usage) };
    },
    async *stream({ endpoint, apiKey, model, messages, maxTokens, temperature }) {
      let response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: headers(apiKey),
          body: JSON.stringify(bodyFor({ model, messages, maxTokens, temperature, stream: true })),
        });
      } catch (error) {
        throw clientError(`LLM provider request failed: ${error.message}`, 502, 'LLM_PROVIDER_ERROR');
      }
      if (!response.ok || !response.body) {
        throw clientError(`LLM provider returned status ${response.status}`, 502, 'LLM_PROVIDER_ERROR');
      }
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      // Parse the provider's SSE frames: `data: {json}` lines, terminating on `data: [DONE]`.
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let frame;
          try { frame = JSON.parse(data); } catch { continue; }
          const delta = frame?.choices?.[0]?.delta?.content;
          if (delta) yield { type: 'delta', content: String(delta) };
          if (frame?.usage) usage = normalizeUsage(frame.usage);
        }
      }
      yield { type: 'usage', usage };
    },
  };
}

// Coerce a provider usage object (snake_case OpenAI shape OR our camelCase) into the canonical
// `{ promptTokens, completionTokens, totalTokens }` shape, defaulting total to the sum.
function normalizeUsage(u = {}) {
  const prompt = Number(u?.promptTokens ?? u?.prompt_tokens ?? 0) || 0;
  const completion = Number(u?.completionTokens ?? u?.completion_tokens ?? 0) || 0;
  const total = Number(u?.totalTokens ?? u?.total_tokens ?? prompt + completion) || prompt + completion;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
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
// fallback); with a `pool` it persists to `workspace_llm_providers` on the metadata DB.
// ---------------------------------------------------------------------------
export function createLlmProviderStore({ pool } = {}) {
  if (!pool) return createInMemoryProviderStore();
  return createPostgresProviderStore(pool);
}

function providerKey(tenantId, workspaceId) {
  return `${tenantId ?? TENANT_SENTINEL}${workspaceId}`;
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

function createInMemoryProviderStore() {
  const providers = new Map(); // (tenant, workspace) -> record
  return {
    async ensureSchema() {},
    async deployProvider(workspaceId, config = {}) {
      if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING');
      const record = {
        ...sanitizeProviderConfig(config),
        workspaceId,
        tenantId: config.tenantId ?? TENANT_SENTINEL,
        updatedAt: new Date().toISOString(),
      };
      providers.set(providerKey(config.tenantId, workspaceId), record);
      return { ...record };
    },
    async getProvider(workspaceId, tenantId) {
      return providers.get(providerKey(tenantId, workspaceId)) ?? null;
    },
    async removeProvider(workspaceId, tenantId) {
      const had = providers.delete(providerKey(tenantId, workspaceId));
      return { removed: had };
    },
  };
}

function createPostgresProviderStore(pool) {
  async function ensureSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS workspace_llm_providers (
      tenant_id      text NOT NULL,
      workspace_id   text NOT NULL,
      provider_type  text,
      endpoint       text,
      allowed_models jsonb NOT NULL DEFAULT '[]'::jsonb,
      default_model  text,
      secret_ref     jsonb,
      updated_at     timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, workspace_id)
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_wlp_workspace ON workspace_llm_providers (workspace_id)');
  }
  function rowToRecord(row) {
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      providerType: row.provider_type ?? undefined,
      endpoint: row.endpoint ?? undefined,
      allowedModels: Array.isArray(row.allowed_models) ? row.allowed_models : [],
      defaultModel: row.default_model ?? undefined,
      secretRef: row.secret_ref ?? undefined,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
  }
  return {
    pool,
    ensureSchema,
    async deployProvider(workspaceId, config = {}) {
      if (!workspaceId) throw clientError('Missing workspace', 400, 'WORKSPACE_MISSING');
      const safe = sanitizeProviderConfig(config);
      const tenant = config.tenantId ?? TENANT_SENTINEL;
      const res = await pool.query(
        `INSERT INTO workspace_llm_providers
           (tenant_id, workspace_id, provider_type, endpoint, allowed_models, default_model, secret_ref, updated_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb, now())
         ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET
           provider_type  = EXCLUDED.provider_type,
           endpoint       = EXCLUDED.endpoint,
           allowed_models = EXCLUDED.allowed_models,
           default_model  = EXCLUDED.default_model,
           secret_ref     = EXCLUDED.secret_ref,
           updated_at     = now()
         RETURNING tenant_id, workspace_id, provider_type, endpoint, allowed_models, default_model, secret_ref, updated_at`,
        [
          tenant, workspaceId, safe.providerType ?? null, safe.endpoint ?? null,
          JSON.stringify(safe.allowedModels ?? []), safe.defaultModel ?? null,
          safe.secretRef !== undefined ? JSON.stringify(safe.secretRef) : null,
        ],
      );
      return rowToRecord(res.rows[0]);
    },
    async getProvider(workspaceId, tenantId) {
      const res = tenantId
        ? await pool.query('SELECT * FROM workspace_llm_providers WHERE tenant_id = $1 AND workspace_id = $2 LIMIT 1', [tenantId, workspaceId])
        : await pool.query('SELECT * FROM workspace_llm_providers WHERE workspace_id = $1 LIMIT 1', [workspaceId]);
      return rowToRecord(res.rows[0]);
    },
    async removeProvider(workspaceId, tenantId) {
      const res = tenantId
        ? await pool.query('DELETE FROM workspace_llm_providers WHERE tenant_id = $1 AND workspace_id = $2 RETURNING workspace_id', [tenantId, workspaceId])
        : await pool.query('DELETE FROM workspace_llm_providers WHERE workspace_id = $1 RETURNING workspace_id', [workspaceId]);
      return { removed: res.rowCount > 0 };
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
    return { content: out.content ?? '', usage, model: chosen };
  }

  // Streaming variant: yields `{ type:'delta', content }` frames, records usage when the terminal
  // usage frame arrives, then yields a final `{ type:'usage', usage }` frame.
  async function* completeStream(workspaceId, { tenantId, model, messages, prompt, system, maxTokens, temperature } = {}) {
    const { config, chosen, apiKey, backend } = await prepare(workspaceId, { tenantId, model });
    const built = normalizeMessages({ messages, prompt, system });
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    for await (const frame of backend.stream({ endpoint: config.endpoint, apiKey, model: chosen, messages: built, maxTokens, temperature })) {
      if (frame?.type === 'usage') { usage = normalizeUsage(frame.usage); continue; }
      yield { type: 'delta', content: frame?.content ?? '' };
    }
    await usageStore.recordUsage(workspaceId, { tenantId, model: chosen, ...usage });
    yield { type: 'usage', usage, model: chosen };
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
    getProvider: (workspaceId, tenantId) => providerStore.getProvider(workspaceId, tenantId),
    removeProvider: (workspaceId, tenantId) => providerStore.removeProvider(workspaceId, tenantId),
    complete,
    completeStream,
    getUsage,
    ensureSchema,
  };
}
