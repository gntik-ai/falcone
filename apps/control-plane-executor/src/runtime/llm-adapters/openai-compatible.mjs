// Pure OpenAI chat-completions wire adapter (#940). No I/O or credential retention.
import { adapterError, normalizeUsage, normalizeFinishReason, assertNormalizedCompletion } from './contract.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const usageFields = usage => ({
  promptTokens: usage?.prompt_tokens,
  completionTokens: usage?.completion_tokens,
  totalTokens: usage?.total_tokens,
  cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
  reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
});

export const openaiCompatibleAdapter = Object.freeze({
  id: 'openai-compatible',
  providerTypes: Object.freeze(['openai', 'openai-compatible', 'deepseek', 'moonshot-kimi']),
  surface: Object.freeze({ streaming: true, usageInStream: true, systemRole: true, toolCalls: false, structuredOutput: false }),
  buildRequest(request, { endpoint, apiKey }) {
    return {
      url: endpoint,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: {
        model: request.model, messages: request.messages,
        ...(request.maxTokens != null ? { max_tokens: Number(request.maxTokens) } : {}),
        ...(request.temperature != null ? { temperature: Number(request.temperature) } : {}),
        ...(request.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      },
    };
  },
  parseResponse({ status, headers, json }) {
    if (status < 200 || status >= 300) throw this.mapError({ status, headers });
    const choice = json?.choices?.[0];
    if (!Array.isArray(json?.choices) || !isObject(choice?.message)
      || (json.usage != null && !isObject(json.usage))
      || !(typeof choice.message.content === 'string' || choice.message.content === null)) {
      throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    }
    return assertNormalizedCompletion({
      content: choice.message.content ?? '', model: json.model ?? '',
      usage: normalizeUsage(usageFields(json.usage)), finishReason: normalizeFinishReason(choice.finish_reason),
    });
  },
  createStreamState() {
    return { finishReason: null, usage: null };
  },
  parseStreamData(data, state) {
    if (data === '[DONE]') return { frames: [], done: true };
    let json;
    try { json = JSON.parse(data); } catch { throw adapterError('LLM_PROVIDER_RESPONSE_INVALID'); }
    const choice = json?.choices?.[0];
    if (!isObject(json) || (json.usage != null && !isObject(json.usage))
      || (json.choices != null && !Array.isArray(json.choices))
      || (choice?.delta != null && !isObject(choice.delta))
      || !(isObject(choice?.delta) || choice?.finish_reason != null || isObject(json.usage))) {
      throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    }
    if (json.model != null) {
      if (typeof json.model !== 'string') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      state.model = json.model;
    }
    if (choice?.finish_reason != null) state.finishReason = normalizeFinishReason(choice.finish_reason);
    if (json.usage != null) {
      const values = usageFields(json.usage);
      const carried = Object.fromEntries(Object.entries(values).filter(([, value]) => value != null));
      state.usage = normalizeUsage({ ...state.usage, ...carried,
        totalTokens: carried.totalTokens ?? (carried.promptTokens != null || carried.completionTokens != null
          ? (carried.promptTokens ?? state.usage?.promptTokens ?? 0) + (carried.completionTokens ?? state.usage?.completionTokens ?? 0)
          : state.usage?.totalTokens),
      });
    }
    const content = choice?.delta?.content;
    if (content != null && typeof content !== 'string') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    return { frames: content ? [{ type: 'delta', content }] : [], done: false };
  },
  mapError({ status, headers, cause } = {}) {
    if (status === 401 || status === 403) return adapterError('LLM_PROVIDER_AUTH_FAILED');
    if (status === 429) {
      const header = name => typeof headers?.get === 'function' ? headers.get(name)
        : Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
      const value = header('retry-after');
      const seconds = value == null || value === '' ? NaN : Number(value);
      // HTTP-date arithmetic is pure: the transport supplies a Date header if absent.
      const dateDelay = Date.parse(value) - Date.parse(header('date'));
      const retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000
        : Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : undefined;
      return adapterError('LLM_PROVIDER_RATE_LIMITED', retryAfterMs);
    }
    if (status >= 400 && status < 500) return adapterError('LLM_PROVIDER_REQUEST_REJECTED');
    if ((status >= 500 && status < 600) || cause) return adapterError('LLM_PROVIDER_UNAVAILABLE');
    return adapterError('LLM_PROVIDER_ERROR');
  },
});
