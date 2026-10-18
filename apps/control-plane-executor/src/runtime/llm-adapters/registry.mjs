// Native adapters can register here; all other provider types retain compatible behavior (#940).
import { openaiCompatibleAdapter } from './openai-compatible.mjs';
import { openaiResponsesAdapter } from './openai-responses.mjs';
import { anthropicMessagesAdapter } from './anthropic-messages.mjs';
import { geminiGenerateContentAdapter } from './gemini-generate-content.mjs';

export function resolveLlmAdapter(providerType) {
  if (providerType === 'gemini') return geminiGenerateContentAdapter;
  if (providerType === 'anthropic') return anthropicMessagesAdapter;
  return providerType === 'openai-responses' ? openaiResponsesAdapter : openaiCompatibleAdapter;
}

// Optional provider-neutral batch protocol. Mapping stays in the provider adapter.
export function resolveBatchDriver(providerType) {
  return resolveLlmAdapter(providerType).batch;
}
