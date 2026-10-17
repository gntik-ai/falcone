// Pure stateless Anthropic Messages wire adapter (#942). No I/O or credential retention.
import { adapterError, normalizeUsage, assertNormalizedCompletion } from './contract.mjs';
import { openaiCompatibleAdapter } from './openai-compatible.mjs';

export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finishReason = reason => reason == null ? null : reason === 'end_turn' || reason === 'stop_sequence' ? 'stop'
  : reason === 'max_tokens' ? 'length' : reason === 'tool_use' ? 'tool_calls' : reason === 'refusal' ? 'content_filter' : 'other';
const usageFields = usage => {
  const normalized = normalizeUsage({ promptTokens: usage?.input_tokens, completionTokens: usage?.output_tokens,
    cacheReadTokens: usage?.cache_read_input_tokens, cacheWriteTokens: usage?.cache_creation_input_tokens });
  const promptTokens = normalized.promptTokens + (normalized.cacheReadTokens ?? 0) + (normalized.cacheWriteTokens ?? 0);
  return { ...normalized, promptTokens, totalTokens: promptTokens + normalized.completionTokens };
};

export const anthropicMessagesAdapter = Object.freeze({
  id: 'anthropic-messages',
  providerTypes: Object.freeze(['anthropic']),
  surface: Object.freeze({ streaming: true, usageInStream: true, systemRole: true, toolCalls: false, structuredOutput: false }),
  buildRequest(request, { endpoint, apiKey }) {
    const system = request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
    return {
      url: endpoint,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model: request.model, max_tokens: request.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
        messages: request.messages.filter(message => message.role !== 'system'),
        ...(request.messages.some(message => message.role === 'system') ? { system: request.promptCache === 'system'
          ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system } : {}),
        ...(request.temperature != null ? { temperature: Number(request.temperature) } : {}),
        ...(request.stream ? { stream: true } : {}),
      },
    };
  },
  parseResponse({ status, headers, json }) {
    if (status < 200 || status >= 300) throw this.mapError({ status, headers });
    if (!isObject(json) || json.type !== 'message' || !Array.isArray(json.content)
      || (json.usage != null && !isObject(json.usage))
      || json.content.some(part => !isObject(part) || typeof part.type !== 'string'
        || (part.type === 'text' && typeof part.text !== 'string'))) {
      throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    }
    return assertNormalizedCompletion({
      content: json.content.filter(part => part.type === 'text').map(part => part.text).join(''),
      model: json.model ?? '', usage: usageFields(json.usage), finishReason: finishReason(json.stop_reason),
    });
  },
  createStreamState() {
    return { finishReason: null, usage: null, counts: {} };
  },
  parseStreamData(data, state) {
    let json;
    try { json = JSON.parse(data); } catch { throw adapterError('LLM_PROVIDER_RESPONSE_INVALID'); }
    if (!isObject(json) || typeof json.type !== 'string') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    if (json.type === 'error') {
      const type = json.error?.type;
      throw adapterError(type === 'overloaded_error' || type === 'api_error' ? 'LLM_PROVIDER_UNAVAILABLE'
        : type === 'rate_limit_error' ? 'LLM_PROVIDER_RATE_LIMITED' : 'LLM_PROVIDER_ERROR');
    }
    let usage;
    if (json.type === 'message_start') {
      if (!isObject(json.message) || (json.message.model != null && typeof json.message.model !== 'string')) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      if (json.message.model != null) state.model = json.message.model;
      usage = json.message.usage;
    }
    if (json.type === 'message_delta') {
      if (!isObject(json.delta)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      if (json.delta.stop_reason != null) state.finishReason = finishReason(json.delta.stop_reason);
      usage = json.usage;
    }
    if (usage != null) {
      if (!isObject(usage)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      for (const field of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) {
        if (usage[field] != null) state.counts[field] = usage[field];
      }
      state.usage = usageFields(state.counts);
    }
    if (json.type === 'content_block_delta') {
      if (!isObject(json.delta)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      if (json.delta.type === 'text_delta') {
        if (typeof json.delta.text !== 'string') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
        return { frames: [{ type: 'delta', content: json.delta.text }], done: false };
      }
    }
    return { frames: [], done: json.type === 'message_stop' };
  },
  mapError: openaiCompatibleAdapter.mapError,
});
