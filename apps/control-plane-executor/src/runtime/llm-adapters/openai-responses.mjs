// Pure stateless Responses wire adapter (add-native-openai-provider-adapter / #941).
import { adapterError, normalizeUsage, normalizeFinishReason, assertNormalizedCompletion } from './contract.mjs';
import { openaiCompatibleAdapter } from './openai-compatible.mjs';

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
