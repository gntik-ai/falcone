// Provider I/O boundary (#940). Pure adapters own translation and protocol semantics.
import { clientError } from '../errors.mjs';
import { AdapterError, adapterError, assertNormalizedCompletion, assertNormalizedFrame, normalizeUsage } from './contract.mjs';

export function createLlmTransport({ adapter, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw clientError('httpLlmBackend requires a fetch implementation', 500, 'LLM_CONFIG');

  async function fetchRaw({ method = 'POST', url, headers, body, redirect }) {
    let response;
    try { response = await fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}), ...(redirect !== undefined ? { redirect } : {}) }); }
    catch (cause) { throw Object.assign(adapter.mapError({ cause }), { phase: 'network' }); }
    if (!response.ok) {
      const errorHeaders = new Headers(response.headers);
      if (!errorHeaders.has('date')) errorHeaders.set('date', new Date().toUTCString());
      throw Object.assign(adapter.mapError({ status: response.status, headers: errorHeaders }), { phase: 'response', httpStatus: response.status });
    }
    return response;
  }

  async function requestJson(request) {
    const response = await fetchRaw(request);
    try { return await response.json(); }
    catch (cause) {
      const error = cause instanceof SyntaxError ? adapterError('LLM_PROVIDER_RESPONSE_INVALID') : adapter.mapError({ cause });
      throw Object.assign(error, { phase: 'body' });
    }
  }

  async function send(request) {
    const { url, headers, body } = adapter.buildRequest(request, request);
    return fetchRaw({ method: 'POST', url, headers, body: JSON.stringify(body) });
  }

  // One decoder is retained across chunks for both SSE and JSONL.
  async function* lines(body) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        yield buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) yield buffer.replace(/\r$/, '');
  }
  async function* dataLines(body) {
    for await (const line of lines(body)) if (line.startsWith('data:')) yield line.slice(5).trim();
  }
  async function* jsonLines(body) {
    try {
      if (!body) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
      for await (const line of lines(body)) if (line.trim()) yield line;
    } catch (cause) {
      throw Object.assign(cause instanceof AdapterError ? cause : adapterError('LLM_PROVIDER_RESPONSE_INVALID'), { phase: 'body' });
    }
  }

  return {
    fetchRaw, requestJson, jsonLines,
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
        if (cause instanceof SyntaxError) throw Object.assign(adapterError('LLM_PROVIDER_RESPONSE_INVALID'), { phase: 'body' });
        throw Object.assign(adapter.mapError({ cause }), { phase: 'body' });
      }
      const result = adapter.parseResponse({ status: response.status, headers: response.headers, json });
      return assertNormalizedCompletion({ ...result, model: result.model || request.model });
    },
  };
}
