// Pure stateless Gemini generateContent wire adapter (#943). No I/O or credential retention.
import { adapterError, normalizeUsage, assertNormalizedCompletion } from './contract.mjs';
import { openaiCompatibleAdapter } from './openai-compatible.mjs';

// Frozen responseJsonSchema vocabulary: https://ai.google.dev/api/generate-content#v1beta.GenerationConfig
export const GEMINI_RESPONSE_JSON_SCHEMA_KEYWORDS = Object.freeze(['$id', '$defs', '$ref', '$anchor', 'type', 'format', 'title', 'description', 'enum',
  'items', 'prefixItems', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'oneOf', 'properties', 'additionalProperties', 'required', 'propertyOrdering']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function supportsSchema(schema) {
  if (!isObject(schema)) return typeof schema === 'boolean';
  return Object.entries(schema).every(([key, value]) => {
    if (!GEMINI_RESPONSE_JSON_SCHEMA_KEYWORDS.includes(key)) return false;
    if (key === 'properties' || key === '$defs') return isObject(value) && Object.values(value).every(supportsSchema);
    if (key === 'items' || key === 'additionalProperties') return supportsSchema(value);
    if (key === 'prefixItems' || key === 'anyOf' || key === 'oneOf') return Array.isArray(value) && value.every(supportsSchema);
    return true;
  });
}
const finishReason = reason => reason == null ? null : reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length'
  : ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(reason) ? 'content_filter' : 'other';
const usageFields = usage => {
  if (usage != null && !isObject(usage)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  const normalized = normalizeUsage({ promptTokens: usage?.promptTokenCount, completionTokens: usage?.candidatesTokenCount,
    cacheReadTokens: usage?.cachedContentTokenCount, reasoningTokens: usage?.thoughtsTokenCount });
  const completionTokens = normalized.completionTokens + (normalized.reasoningTokens ?? 0);
  return normalizeUsage({ ...normalized, completionTokens, totalTokens: usage?.totalTokenCount ?? normalized.promptTokens + completionTokens });
};
function candidateText(candidate) {
  if (!isObject(candidate) || (candidate.content != null && !isObject(candidate.content))
    || (candidate.content?.parts != null && !Array.isArray(candidate.content.parts))) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  const parts = candidate.content?.parts ?? [];
  if (parts.some(part => !isObject(part) || (Object.hasOwn(part, 'text') && typeof part.text !== 'string'))) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  return parts.filter(part => part.thought !== true && typeof part.text === 'string').map(part => part.text).join('');
}

export const geminiGenerateContentAdapter = Object.freeze({
  id: 'gemini-generate-content',
  providerTypes: Object.freeze(['gemini']),
  surface: Object.freeze({ streaming: true, usageInStream: true, systemRole: true, toolCalls: false, structuredOutput: true }),
  supportsResponseFormat(responseFormat) {
    return supportsSchema(responseFormat.schema);
  },
  buildRequest(request, { endpoint, apiKey }) {
    const url = new URL(endpoint);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(request.model)}:${request.stream ? 'streamGenerateContent' : 'generateContent'}`;
    if (request.stream) url.search = `${url.search}${url.search ? '&' : '?'}alt=sse`;
    const generationConfig = {
      ...(request.maxTokens != null ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.temperature != null ? { temperature: Number(request.temperature) } : {}),
      ...(request.responseFormat ? { responseMimeType: 'application/json', responseJsonSchema: request.responseFormat.schema } : {}),
    };
    return {
      url: url.href,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: {
        contents: request.messages.filter(message => message.role !== 'system').map(message => ({
          role: message.role === 'assistant' ? 'model' : message.role, parts: [{ text: message.content }],
        })),
        ...(request.messages.some(message => message.role === 'system') ? { systemInstruction: { parts: [{
          text: request.messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'),
        }] } } : {}),
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      },
    };
  },
  parseResponse({ status, headers, json }) {
    if (status < 200 || status >= 300) throw this.mapError({ status, headers });
    if (!isObject(json)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    const blocked = json.promptFeedback?.blockReason && (json.candidates == null || (Array.isArray(json.candidates) && json.candidates.length === 0));
    if (!blocked && (!Array.isArray(json.candidates) || !json.candidates.length)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    return assertNormalizedCompletion({ content: blocked ? '' : candidateText(json.candidates[0]),
      model: typeof json.modelVersion === 'string' ? json.modelVersion : '', usage: usageFields(json.usageMetadata),
      finishReason: blocked ? 'content_filter' : finishReason(json.candidates[0].finishReason),
    });
  },
  createStreamState() {
    return { finishReason: null, usage: null };
  },
  parseStreamData(data, state) {
    let json;
    try { json = JSON.parse(data); } catch { throw adapterError('LLM_PROVIDER_RESPONSE_INVALID'); }
    if (!isObject(json)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    if (isObject(json.error)) {
      const { code, status } = json.error;
      throw adapterError(code === 429 || status === 'RESOURCE_EXHAUSTED' ? 'LLM_PROVIDER_RATE_LIMITED'
        : code === 500 || code === 503 || status === 'INTERNAL' || status === 'UNAVAILABLE' ? 'LLM_PROVIDER_UNAVAILABLE' : 'LLM_PROVIDER_ERROR');
    }
    if ((json.candidates != null && !Array.isArray(json.candidates))
      || (!Array.isArray(json.candidates) && json.usageMetadata == null && !json.promptFeedback?.blockReason)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
    if (typeof json.modelVersion === 'string') state.model = json.modelVersion;
    if (json.usageMetadata != null) state.usage = usageFields(json.usageMetadata);
    let content = '';
    if (json.candidates?.length) {
      content = candidateText(json.candidates[0]);
      if (json.candidates[0].finishReason != null) state.finishReason = finishReason(json.candidates[0].finishReason);
    }
    if (json.promptFeedback?.blockReason) state.finishReason = 'content_filter';
    return { frames: content ? [{ type: 'delta', content }] : [], done: false };
  },
  completeAtEof(state) {
    return state.finishReason !== null;
  },
  mapError: openaiCompatibleAdapter.mapError,
});
