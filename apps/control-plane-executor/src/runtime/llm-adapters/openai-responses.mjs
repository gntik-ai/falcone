// Pure stateless Responses wire adapter (add-native-openai-provider-adapter / #941).
import { adapterError, normalizeUsage, normalizeFinishReason, assertNormalizedCompletion } from './contract.mjs';
import { clientError } from '../errors.mjs';
import { openaiCompatibleAdapter } from './openai-compatible.mjs';

const SUBMIT_INTERRUPTED_MS = 5 * 60_000;
const SWEEP_LOOKBACK_MS = 10 * 60_000;
const DELETE_FENCE_MS = 15 * 60_000;
const UNCERTAIN_LIFETIME_MS = 25 * 60 * 60_000;
const SWEEP_PAGE_LIMIT = 5;
const BATCH_LIST_LIMIT = 100;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const providerError = code => adapterError(code === 'rate_limit_exceeded' ? 'LLM_PROVIDER_RATE_LIMITED'
  : code === 'server_error' ? 'LLM_PROVIDER_UNAVAILABLE' : 'LLM_PROVIDER_ERROR');
const usageFields = usage => ({
  promptTokens: usage?.input_tokens,
  completionTokens: usage?.output_tokens,
  totalTokens: usage?.total_tokens,
  cacheReadTokens: usage?.input_tokens_details?.cached_tokens,
  cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens,
  reasoningTokens: usage?.output_tokens_details?.reasoning_tokens,
});
const finishReason = json => normalizeFinishReason(json.status === 'completed' ? 'stop'
  : json.incomplete_details?.reason === 'max_output_tokens' ? 'length'
    : json.incomplete_details?.reason === 'content_filter' ? 'content_filter' : 'other');

export const openaiResponsesAdapter = Object.freeze({
  batch: Object.freeze({
    guardEachRequest: true,
    validateEndpoint(endpoint) { this.url(endpoint, 'files'); },
    url(endpoint, resource, id, operation) {
      const url = new URL(endpoint);
      if (!url.pathname.endsWith('/v1/responses')) throw clientError('Provider does not support batches', 422, 'LLM_BATCH_UNSUPPORTED');
      url.pathname = `${url.pathname.slice(0, -'/responses'.length)}/${resource}${id == null ? '' : `/${encodeURIComponent(id)}`}${operation ? `/${operation}` : ''}`;
      return url.href;
    },
    buildLine(item, ctx) {
      const { stream, ...body } = openaiResponsesAdapter.buildRequest(item, ctx).body;
      return { custom_id: item.customId, method: 'POST', url: '/v1/responses', body };
    },
    buildCreate(inputFileId, batchId) {
      return { input_file_id: inputFileId, endpoint: '/v1/responses', completion_window: '24h', metadata: { falcone_batch_id: batchId } };
    },
    async submit(ctx) {
      const url = this.url(ctx.endpoint, 'files');
      const form = new FormData();
      form.set('purpose', 'batch');
      form.set('file', new Blob([ctx.items.map(item => JSON.stringify(this.buildLine(item, ctx))).join('\n') + '\n'], { type: 'application/jsonl' }), 'batch.jsonl');
      let inputFileId;
      try {
        const uploaded = await ctx.transport.requestJson({ method: 'POST', url, headers: batchHeaders(ctx, false), body: form, redirect: 'error' });
        if (typeof uploaded?.id !== 'string' || !uploaded.id) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
        inputFileId = uploaded.id;
      } catch (error) { return { type: 'failedBeforeCreate', error }; }
      await ctx.persist({ inputFileId, createIssuedAt: new Date(ctx.now()).toISOString() });
      try {
        const json = await ctx.transport.requestJson({ method: 'POST', url: this.url(ctx.endpoint, 'batches'), headers: batchHeaders(ctx),
          body: JSON.stringify(this.buildCreate(inputFileId, ctx.batchId)), redirect: 'error' });
        let parsed;
        try { parsed = this.parseBatch(json); } catch (error) { throw Object.assign(error, { phase: 'body' }); }
        return { type: 'accepted', providerBatchId: parsed.providerBatchId, expiresAt: parsed.expiresAt };
      } catch (error) {
        if (error.phase === 'response' && error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 408) {
          await deleteFile(this, ctx, inputFileId).catch(() => {});
        }
        throw error;
      }
    },
    async poll(ctx) {
      return this.parseBatch(await ctx.transport.requestJson({ method: 'GET', url: this.url(ctx.endpoint, 'batches', ctx.providerBatchId), headers: batchHeaders(ctx), redirect: 'error' }));
    },
    async cancel(ctx) {
      return this.parseBatch(await ctx.transport.requestJson({ method: 'POST', url: this.url(ctx.endpoint, 'batches', ctx.providerBatchId, 'cancel'), headers: batchHeaders(ctx), redirect: 'error' }));
    },
    interruptedSubmission(row, time) {
      return !row.providerState.inputFileId && time - Date.parse(row.createdAt) >= SUBMIT_INTERRUPTED_MS
        ? { type: 'failed', errorCode: 'LLM_BATCH_SUBMIT_INTERRUPTED', clearBinding: true } : null;
    },
    async resolveUncertain(ctx) {
      const state = { ...ctx.providerState };
      if (!state.inputFileId) return this.interruptedSubmission(ctx, ctx.now()) ?? { type: 'pending' };
      const issued = Date.parse(state.createIssuedAt);
      if (!Number.isFinite(issued)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      const started = state.sweepStartedAt ?? new Date(ctx.now()).toISOString();
      let after = state.sweepAfter ?? null;
      for (let page = 0; page < SWEEP_PAGE_LIMIT; page++) {
        const url = new URL(this.url(ctx.endpoint, 'batches'));
        url.searchParams.set('limit', String(BATCH_LIST_LIMIT));
        if (after) url.searchParams.set('after', after); else url.searchParams.delete('after');
        const json = await ctx.transport.requestJson({ method: 'GET', url: url.href, headers: batchHeaders(ctx), redirect: 'error' });
        if (!isObject(json) || json.object !== 'list' || !Array.isArray(json.data) || typeof json.has_more !== 'boolean'
          || (json.has_more && !json.data.length) || json.data.some(item => !isObject(item) || item.object !== 'batch'
            || typeof item.id !== 'string' || !item.id || !Number.isFinite(item.created_at))) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
        const match = json.data.find(item => item.input_file_id === state.inputFileId && item.metadata?.falcone_batch_id === ctx.batchId);
        if (match) {
          const parsed = this.parseBatch(match);
          await ctx.persist({ ...parsed.providerState, sweepStartedAt: null, sweepAfter: null });
          return { type: 'accepted', providerBatchId: parsed.providerBatchId, expiresAt: parsed.expiresAt };
        }
        const complete = !json.has_more || json.data.some(item => item.created_at * 1000 < Date.parse(ctx.createdAt) - SWEEP_LOOKBACK_MS);
        if (complete) {
          await ctx.persist({ sweepStartedAt: null, sweepAfter: null });
          if (!state.inputFileDeletedAt && Date.parse(started) >= issued + DELETE_FENCE_MS) {
            try { await deleteFile(this, ctx, state.inputFileId); }
            catch (error) { if (error.httpStatus !== 404) throw error; }
            try {
              await ctx.transport.fetchRaw({ method: 'GET', url: this.url(ctx.endpoint, 'files', state.inputFileId), headers: batchHeaders(ctx), redirect: 'error' });
              return { type: 'pending' }; // A successful DELETE alone is not proof.
            } catch (error) { if (error.httpStatus !== 404) throw error; }
            await ctx.persist({ inputFileDeletedAt: new Date(ctx.now()).toISOString() });
            return { type: 'pending' }; // This sweep predates deletion: start another.
          }
          if (state.inputFileDeletedAt && Date.parse(started) >= issued + UNCERTAIN_LIFETIME_MS
            && Date.parse(started) >= Date.parse(state.inputFileDeletedAt)) return { type: 'failed', errorCode: 'LLM_BATCH_SUBMIT_UNCERTAIN' };
          return { type: 'pending' };
        }
        const next = json.data.at(-1).id;
        if (next === after) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
        after = next;
        await ctx.persist({ sweepStartedAt: started, sweepAfter: after });
      }
      return { type: 'pending' };
    },
    results(ctx) {
      const driver = this;
      return { streams: (async function* () {
        for (const [file, id] of [['output', ctx.providerState.outputFileId], ['error', ctx.providerState.errorFileId]]) {
          if (!id) continue;
          const response = await ctx.transport.fetchRaw({ method: 'GET', url: driver.url(ctx.endpoint, 'files', id, 'content'), headers: batchHeaders(ctx), redirect: 'error' });
          yield { file, lines: ctx.transport.jsonLines(response.body) };
        }
      })() };
    },
    countsMatch(provider, actual, items) {
      return provider?.total === items.length && providerAccountingMatches(provider, items);
    },
    absentItems(polled, items) {
      if (!providerAccountingMatches(polled.counts, items)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      const status = polled.expired ? 'expired' : polled.canceled ? 'canceled' : null;
      return status ? items.filter(item => item.status === 'pending').map(item => ({ customId: item.customId, status })) : [];
    },
    finalStatus(polled, counts, row) {
      return polled.expired ? 'expired' : row.cancelAcknowledgedAt ? 'cancelled' : counts.expired === row.requestCount ? 'expired' : 'completed';
    },
    failedItems(item) {
      return { customId: item.customId, status: 'errored', errorCode: 'LLM_PROVIDER_REQUEST_REJECTED' };
    },
    async cleanup(ctx) {
      for (const id of new Set([ctx.providerState.inputFileId, ctx.providerState.outputFileId, ctx.providerState.errorFileId].filter(Boolean))) {
        await deleteFile(this, ctx, id).catch(() => {});
      }
    },
    parseResultLine(line, customIds, { file = 'output' } = {}) {
      let json;
      try { json = JSON.parse(line); } catch { throw adapterError('LLM_PROVIDER_RESPONSE_INVALID'); }
      if (!isObject(json) || !customIds.has(json.custom_id)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      const status = json.response?.status_code;
      const item = { customId: json.custom_id, providerDetail: { file, httpStatus: Number.isInteger(status) ? status : null } };
      if (isObject(json.response)) {
        if (!Number.isInteger(status) || status < 100 || status > 599) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
        if (status >= 200 && status < 300) {
          try { return { ...item, status: 'succeeded', ...openaiResponsesAdapter.parseResponse({ status: 200, headers: new Headers(), json: json.response.body }) }; }
          catch (error) {
            if (error.name !== 'AdapterError' || error.code === 'LLM_PROVIDER_RESPONSE_INVALID') throw error;
            return { ...item, status: 'errored', errorCode: error.code };
          }
        }
        return { ...item, status: 'errored', errorCode: openaiResponsesAdapter.mapError({ status }).code };
      }
      if (isObject(json.error)) {
        if (json.error.code === 'batch_expired') return { ...item, status: 'expired' };
        if (json.error.code === 'batch_cancelled') return { ...item, status: 'canceled' };
        return { ...item, status: 'errored', errorCode: 'LLM_PROVIDER_ERROR' };
      }
      throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    },
    parseBatch(json) {
      const statuses = ['validating', 'in_progress', 'finalizing', 'cancelling', 'completed', 'expired', 'cancelled', 'failed'];
      const validTime = value => value == null || (Number.isFinite(value) && value >= 0 && Number.isFinite(new Date(value * 1000).getTime()));
      if (!isObject(json) || json.object !== 'batch' || typeof json.id !== 'string' || !json.id || !statuses.includes(json.status)
        || !isObject(json.request_counts) || ['total', 'completed', 'failed'].some(key => !Number.isInteger(json.request_counts[key]) || json.request_counts[key] < 0)
        || !['expires_at', 'cancelling_at', 'completed_at', 'expired_at', 'cancelled_at', 'failed_at'].every(key => validTime(json[key]))
        || [json.output_file_id, json.error_file_id].some(value => value != null && (typeof value !== 'string' || !value))) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      const ended = ['completed', 'expired', 'cancelled', 'failed'].includes(json.status);
      const date = value => value == null ? null : new Date(value * 1000).toISOString();
      return { providerBatchId: json.id, ended, failed: json.status === 'failed', expired: json.status === 'expired',
        canceled: json.status === 'cancelled', counts: { ...json.request_counts }, expiresAt: date(json.expires_at),
        endedAt: ended ? date(json[`${json.status}_at`]) : null, cancelAcknowledged: ['cancelling', 'cancelled'].includes(json.status) || json.cancelling_at != null,
        errorCode: json.status === 'failed' ? json.errors?.data?.[0]?.code ?? null : null,
        providerState: { outputFileId: json.output_file_id ?? null, errorFileId: json.error_file_id ?? null } };
    },
  }),
  id: 'openai-responses',
  providerTypes: Object.freeze(['openai-responses']),
  surface: Object.freeze({ streaming: true, usageInStream: true, systemRole: true, toolCalls: false, structuredOutput: true }),
  buildRequest(request, { endpoint, apiKey }) {
    return {
      url: endpoint,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: {
        model: request.model, input: request.messages.map(({ role, content }) => ({ role, content })), store: false,
        ...(request.maxTokens != null ? { max_output_tokens: Number(request.maxTokens) } : {}),
        ...(request.temperature != null ? { temperature: Number(request.temperature) } : {}),
        ...(request.stream ? { stream: true } : {}),
        ...(request.responseFormat ? { text: { format: { ...request.responseFormat, strict: true } } } : {}),
      },
    };
  },
  parseResponse({ status, headers, json }) {
    if (status < 200 || status >= 300) throw this.mapError({ status, headers });
    if (json?.status === 'failed') throw providerError(json.error?.code);
    if (!['completed', 'incomplete'].includes(json?.status) || !Array.isArray(json.output)
      || (json.usage != null && !isObject(json.usage))
      || json.output.some(item => !isObject(item) || typeof item.type !== 'string'
        || (item.type === 'message' && (!Array.isArray(item.content) || item.content.some(part => !isObject(part)
          || !['output_text', 'refusal'].includes(part.type)
          || (part.type === 'output_text' && typeof part.text !== 'string')
          || (part.type === 'refusal' && typeof part.refusal !== 'string')))))) {
      throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    }
    const parts = json.output.filter(item => item.type === 'message').flatMap(item => item.content);
    const text = parts.filter(part => part.type === 'output_text');
    return assertNormalizedCompletion({
      content: text.map(part => part.text).join(''), model: json.model ?? '', usage: normalizeUsage(usageFields(json.usage)),
      finishReason: text.length === 0 && parts.some(part => part.type === 'refusal') ? 'content_filter' : finishReason(json),
    });
  },
  createStreamState() {
    return { finishReason: null, usage: null };
  },
  parseStreamData(data, state) {
    let json;
    try { json = JSON.parse(data); } catch { throw adapterError('LLM_PROVIDER_RESPONSE_INVALID'); }
    if (!isObject(json) || typeof json.type !== 'string') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    if (json.type === 'response.failed' || json.type === 'error') throw providerError(json.type === 'error' ? json.code : json.response?.error?.code);
    if (json.type === 'response.output_text.delta') {
      if (typeof json.delta !== 'string') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      return { frames: [{ type: 'delta', content: json.delta }], done: false };
    }
    if (json.type === 'response.completed' || json.type === 'response.incomplete') {
      if (json.response?.status !== json.type.slice('response.'.length)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      const completion = this.parseResponse({ status: 200, json: { ...json.response, output: json.response.output ?? [] } });
      Object.assign(state, { usage: completion.usage, model: completion.model || undefined, finishReason: completion.finishReason });
      return { frames: [], done: true };
    }
    return { frames: [], done: false };
  },
  mapError: openaiCompatibleAdapter.mapError,
});

function batchHeaders(ctx, json = true) {
  return { Authorization: `Bearer ${ctx.apiKey}`, ...(json ? { 'content-type': 'application/json' } : {}) };
}
async function deleteFile(driver, ctx, id) {
  return ctx.transport.fetchRaw({ method: 'DELETE', url: driver.url(ctx.endpoint, 'files', id), headers: batchHeaders(ctx), redirect: 'error' });
}

// Items, rather than lines, are durable accounting units across retries.
function providerAccountingMatches(provider, items) {
  let completed = 0, failed = 0;
  for (const { providerDetail: detail } of items) {
    if (detail?.file === 'output' && detail.httpStatus >= 200 && detail.httpStatus < 300) completed++;
    else if (detail?.file === 'error' || detail?.file === 'output') failed++;
  }
  return completed === provider?.completed && failed >= provider?.failed;
}
