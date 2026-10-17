// Provider I/O boundary (#940). Pure adapters own translation and protocol semantics.
import { clientError } from '../errors.mjs';
import { AdapterError, adapterError, assertNormalizedCompletion, assertNormalizedFrame, normalizeUsage } from './contract.mjs';

export function createLlmTransport({ adapter, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw clientError('httpLlmBackend requires a fetch implementation', 500, 'LLM_CONFIG');

  async function send(request) {
    const { url, headers, body } = adapter.buildRequest(request, request);
    let response;
    try { response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch (cause) { throw adapter.mapError({ cause }); }
    if (!response.ok) {
      const errorHeaders = new Headers(response.headers);
      if (!errorHeaders.has('date')) errorHeaders.set('date', new Date().toUTCString());
      throw adapter.mapError({ status: response.status, headers: errorHeaders });
    }
    return response;
  }

  // The streaming decoder keeps partial UTF-8 bytes between reads. A final unterminated
  // line is still protocol data; successful completion is exclusively the adapter's decision.
  async function* dataLines(body) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) yield buffer.slice(5).trim();
  }

  return {
    async *stream(request) {
      // HTTP failures must throw before the server commits SSE headers.
      const response = await send({ ...request, stream: true });
      const state = adapter.createStreamState();
      let terminal;
      try {
        if (!response.body) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
        for await (const data of dataLines(response.body)) {
          let parsed;
          try { parsed = adapter.parseStreamData(data, state); }
          catch (cause) { throw cause instanceof AdapterError ? cause : adapterError('LLM_PROVIDER_RESPONSE_INVALID'); }
          for (const frame of parsed.frames) {
            if (frame.type !== 'delta') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
            yield assertNormalizedFrame(frame);
          }
          if (parsed.done) {
            terminal = assertNormalizedFrame({ type: 'usage', usage: normalizeUsage(state.usage),
              model: state.model ?? request.model, finishReason: state.finishReason ?? null });
            break;
          }
        }
        if (!terminal) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      } catch (cause) {
        const error = cause?.name === 'AdapterError' ? cause : adapter.mapError({ cause });
        yield { type: 'error', code: error.code };
        return;
      }
      yield terminal;
    },
    async complete(request) {
      const response = await send({ ...request, stream: false });
      let json;
      try { json = await response.json(); }
      catch (cause) {
        if (cause instanceof SyntaxError) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
        throw adapter.mapError({ cause });
      }
      const result = adapter.parseResponse({ status: response.status, headers: response.headers, json });
      return assertNormalizedCompletion({ ...result, model: result.model || request.model });
    },
  };
}
