// Native adapters can register here; all other provider types retain compatible behavior (#940).
import { openaiCompatibleAdapter } from './openai-compatible.mjs';

export function resolveLlmAdapter(providerType) {
  return openaiCompatibleAdapter;
}
