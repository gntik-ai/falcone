// Submission orchestration is shared by all batch drivers.
import { createLlmBatchReconciler, batchPollInterval } from './llm-batch-reconciler.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { isBrokeredAuth } from './provider-auth.mjs';
import { clientError } from './errors.mjs';
import { publicBatch } from './llm-batch-store.mjs';
import { resolveBatchDriver, resolveLlmAdapter } from './llm-adapters/registry.mjs';
import { createLlmTransport } from './llm-adapters/transport.mjs';

const SUBMISSION_RECOVERY_MS = 5 * 60_000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function replay(row, inputSha256) {
  if (!row.cancelFence && row.inputSha256 !== inputSha256) throw clientError('Idempotency key input mismatch', 422, 'IDEMPOTENCY_KEY_MISMATCH');
  return { status: 200, body: publicBatch(row) };
}

function pageOptions({ limit = 50, cursor } = {}, kind) {
  limit = Number(limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw clientError('Invalid page limit', 400, 'INVALID_PAGINATION');
  let decoded;
  if (cursor) {
    try {
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (kind === 'batch' ? !Array.isArray(decoded) || decoded.length !== 2 || !Number.isFinite(Date.parse(decoded[0])) || typeof decoded[1] !== 'string'
        : typeof decoded !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(decoded)) throw new Error();
    } catch { throw clientError('Invalid page cursor', 400, 'INVALID_PAGINATION'); }
  }
  return { limit, cursor: decoded };
}
const encodeCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createLlmBatches({ store, prepare, normalizeMessages, fetchImpl, usageStore, resolveSnapshot, intervalMs, now = Date.now, driverResolver = resolveBatchDriver }) {
  const interval = batchPollInterval(intervalMs);
  async function submitBatch(workspaceId, input = {}, { tenantId, principal, idempotencyKey } = {}) {
    const inputSha256 = sha256(canonical(input));
    const hash = idempotencyKey == null ? null : sha256(idempotencyKey);
    if (hash && !principal) throw clientError('Idempotency principal unavailable', 503, 'IDEMPOTENCY_UNAVAILABLE');
    const prior = await store.findBinding(workspaceId, tenantId, principal, hash);
    if (prior) return replay(prior, inputSha256);
    const invalid = () => { throw clientError('Invalid batch request', 400, 'INVALID_LLM_BATCH'); };
    if (!input || typeof input !== 'object'
      || ['stream', 'prompt', 'messages', 'system', 'maxTokens', 'temperature', 'responseFormat', 'promptCache'].some(field => Object.hasOwn(input, field)) || !Array.isArray(input.items)
      || input.items.length < 1 || input.items.length > 1000) invalid();
    const seen = new Set();
    for (const item of input.items) {
      if (!item || typeof item !== 'object' || typeof item.customId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.customId)
        || seen.has(item.customId) || Object.hasOwn(item, 'stream')
        || (item.model != null && item.model !== input.model) || item.connectionId !== undefined
        || (item.maxTokens != null && (!Number.isInteger(item.maxTokens) || item.maxTokens <= 0))
        || (item.temperature != null && !Number.isFinite(item.temperature))) invalid();
      const messages = normalizeMessages(item);
      if (!messages.length || messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) invalid();
      seen.add(item.customId);
    }
    const { config, chosen, apiKey, fetchImpl: authorizedFetch, maxOutputTokens } = await prepare(workspaceId, { ...input, tenantId, batchItems: input.items });
    const driver = driverResolver(config.providerType);
    if (!driver) throw clientError('Provider does not support batches', 422, 'LLM_BATCH_UNSUPPORTED');
    driver.validateEndpoint?.(config.endpoint);
    const batchId = randomUUID();
    await usageStore.checkBudget(workspaceId, { tenantId, model: chosen, connectionId: config.connectionId, providerType: config.providerType,
      mode: 'batch', batchId, requestId: `batch:${batchId}`, attempt: 1 }, input.items.map(item => ({ messages: normalizeMessages(item), maxTokens: item.maxTokens, maxOutputTokens })));
    const timestamp = new Date(now()).toISOString();
    const inserted = await store.insert({ tenantId: tenantId ?? '_', workspaceId, batchId,
      connectionId: config.connectionId, providerType: config.providerType, endpoint: config.endpoint, secretRef: config.secretRef ?? {},
      ...(isBrokeredAuth(config.auth) ? { auth: config.auth, configVersion: config.configVersion } : {}),
      model: chosen, providerBatchId: null, providerState: {}, status: 'submitting', cancelFence: false, requestCount: input.items.length,
      providerCounts: {}, missingCount: 0, inputSha256, idempotencyPrincipal: hash ? principal : null, idempotencyKeySha256: hash,
      lastErrorCode: null, cancelRequestedAt: null, cancelAcknowledgedAt: null, expiresAt: null, endedAt: null,
      resultsAttempts: 0, nextPollAt: new Date(now() + SUBMISSION_RECOVERY_MS).toISOString(), createdAt: timestamp, updatedAt: timestamp,
      leaseOwner: null, leaseExpiresAt: null, leaseVersion: 0,
    }, input.items.map(item => item.customId));
    if (!inserted.created) return replay(inserted.batch, inputSha256);
    let row = inserted.batch;
    // Persist and transition both require the inserted status/version. Lost fencing throws
    // through the driver before another creating call can be made.
    const persist = async state => { row = await store.update(row, { providerState: state, updatedAt: new Date(now()).toISOString() }); };
    let outcome;
    row = await store.update(row, { updatedAt: new Date(now()).toISOString() });
    try {
      outcome = await driver.submit({ batchId: row.batchId, now, endpoint: config.endpoint, apiKey, model: chosen,
        items: input.items.map(item => ({ ...item, model: chosen, messages: normalizeMessages(item) })), persist,
        transport: batchTransport(config.providerType, () => row, driver.guardEachRequest, { apiKey, fetchImpl: authorizedFetch }), providerState: row.providerState });
    } catch (error) {
      const definite = error.phase === 'response' && error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 408;
      const ambiguous = ['network', 'body'].includes(error.phase) || error.httpStatus === 408 || error.httpStatus >= 500;
      if (!definite && !ambiguous) throw error; // A crashed driver leaves submitting for recovery.
      row = await store.update(row, { status: definite ? 'failed' : 'submit_uncertain', lastErrorCode: error.code,
        ...(error.httpStatus === 429 ? { idempotencyKeySha256: null } : {}), updatedAt: new Date(now()).toISOString() });
      if (definite) throw error; // AdapterError status, never the raw provider status.
      return { status: 202, body: publicBatch(row) };
    }
    if (outcome.type === 'failedBeforeCreate') {
      await store.update(row, { status: 'failed', lastErrorCode: outcome.error.code, idempotencyKeySha256: null, updatedAt: new Date(now()).toISOString() });
      throw outcome.error;
    }
    if (outcome.type !== 'accepted' || !outcome.providerBatchId) throw new Error('Invalid batch driver submit outcome');
    row = await store.update(row, { status: 'in_progress', providerBatchId: outcome.providerBatchId, expiresAt: outcome.expiresAt,
      nextPollAt: new Date(now() + interval).toISOString(), updatedAt: new Date(now()).toISOString() });
    return { status: 202, body: publicBatch(row) };
  }
  // Multi-request drivers recheck the lease, endpoint and secret before every I/O,
  // including lazy result streams and cleanup after a terminal transition.
  function batchTransport(providerType, getRow, guard, credential) {
    let initialCredential = credential;
    const transport = createLlmTransport({ adapter: resolveLlmAdapter(providerType), fetchImpl: async (url, init) => {
      const row = getRow();
      if (!isBrokeredAuth(row.auth)) return (fetchImpl ?? globalThis.fetch)(url, init);
      await store.assertLease(row);
      const current = initialCredential ?? await resolveSnapshot(row);
      initialCredential = undefined;
      await store.assertLease(row);
      return current.fetchImpl(url, init, () => store.assertLease(getRow()));
    } });
    if (!guard) return transport;
    const guarded = operation => async request => {
      const row = getRow();
      await store.assertLease(row);
      const { apiKey } = await resolveSnapshot(row);
      await store.assertLease(row);
      return transport[operation]({ ...request, headers: { ...request.headers, Authorization: `Bearer ${apiKey}` } });
    };
    return { ...transport, fetchRaw: guarded('fetchRaw'), requestJson: guarded('requestJson') };
  }
  const batchReconciler = createLlmBatchReconciler({ store, usageStore, driverResolver, now, intervalMs,
    async call(row, operation) {
      await store.assertLease(row);
      const credential = await resolveSnapshot(row);
      const { apiKey } = credential;
      await store.assertLease(row);
      const driver = driverResolver(row.providerType);
      const transport = batchTransport(row.providerType, () => row, driver.guardEachRequest, credential);
      const ctx = { endpoint: row.endpoint, apiKey, batchId: row.batchId, createdAt: row.createdAt, now,
        providerBatchId: row.providerBatchId, providerState: row.providerState, transport,
        async persist(state) {
          const updated = await store.update(row, { providerState: { ...row.providerState, ...state }, updatedAt: new Date(now()).toISOString() });
          row.providerState = updated.providerState;
        } };
      const result = await driver[operation](ctx);
      return operation === 'results' && !result.streams ? { lines: transport.jsonLines(result.body) } : result;
    },
  });
  async function cancelBatch(w, id, { tenantId } = {}) {
    const { batch: row, requested } = await store.requestCancel(w, id, tenantId, now());
    if (!requested || !row.providerBatchId) return publicBatch(row);
    await batchReconciler.runOnce({ batchId: id, workspaceId: w, tenantId, limit: 1, cancelOnly: true });
    return publicBatch(await store.get(w, id, tenantId));
  }
  async function cancelBatchByIdentity(workspaceId, { tenantId, principal, idempotencyKey } = {}) {
    if (!principal || !idempotencyKey) throw clientError('Idempotency identity unavailable', 503, 'IDEMPOTENCY_UNAVAILABLE');
    const timestamp = new Date(now()).toISOString();
    // insert() owns the atomic unique binding lookup/insert transaction. If submission
    // wins, cancel its durable row after releasing the connection, before provider I/O.
    const { batch: row } = await store.insert({ tenantId: tenantId ?? '_', workspaceId, batchId: randomUUID(),
      connectionId: '', providerType: '', endpoint: '', secretRef: {}, model: '',
      providerBatchId: null, providerState: {}, status: 'cancelled', cancelFence: true, requestCount: 0,
      providerCounts: {}, missingCount: 0, inputSha256: null, idempotencyPrincipal: principal, idempotencyKeySha256: sha256(idempotencyKey),
      lastErrorCode: null, cancelRequestedAt: timestamp, cancelAcknowledgedAt: timestamp, expiresAt: null, endedAt: timestamp,
      resultsAttempts: 0, nextPollAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      leaseOwner: null, leaseExpiresAt: null, leaseVersion: 0,
    }, []);
    return cancelBatch(workspaceId, row.batchId, { tenantId });
  }
  return { submitBatch, cancelBatch, cancelBatchByIdentity, batchReconciler, reconcileBatches: batchReconciler.runOnce,
    async getBatch(w, id, { tenantId } = {}) { return publicBatch(await store.get(w, id, tenantId)); },
    deleteBatch: (w, id, { tenantId } = {}) => store.delete(w, id, tenantId),
    async listBatchItems(w, id, options = {}) {
      const { limit, cursor } = pageOptions(options, 'item');
      if (options.status && !['pending', 'succeeded', 'errored', 'canceled', 'expired', 'missing'].includes(options.status)) throw clientError('Invalid item status', 400, 'INVALID_LLM_BATCH_STATUS');
      const found = await store.allItems(w, id, options.tenantId, { limit: limit + 1, cursor, status: options.status || undefined });
      const items = found.slice(0, limit);
      return { items, nextCursor: found.length > limit ? encodeCursor(items.at(-1).customId) : null };
    },
    async listBatches(w, options = {}) {
      const { limit, cursor } = pageOptions(options, 'batch');
      const found = await store.list(w, options.tenantId, { limit: limit + 1, cursor });
      const items = found.slice(0, limit).map(publicBatch);
      return { items, nextCursor: found.length > limit ? encodeCursor([items.at(-1).createdAt, items.at(-1).batchId]) : null };
    },
  };
}
