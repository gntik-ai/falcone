// Native adapters can register here; all other provider types retain compatible behavior (#940).
import { openaiCompatibleAdapter } from './openai-compatible.mjs';
import { openaiResponsesAdapter } from './openai-responses.mjs';

export function resolveLlmAdapter(providerType) {
  return providerType === 'openai-responses' ? openaiResponsesAdapter : openaiCompatibleAdapter;
}
