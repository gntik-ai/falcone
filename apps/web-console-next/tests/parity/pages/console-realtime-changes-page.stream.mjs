// Runs in the browser (page.addInitScript). Replaces fetch for the realtime stream URLs only, with
// scripted text/event-stream responses that the spec can hold, release and extend on demand.
export function streamMock(scripts) {
  const calls = [];
  const connections = [];
  const pending = [];
  const encoder = new TextEncoder();
  window.__streamCalls = calls;
  window.__stream = {
    send(index, text) { connections[index]?.controller.enqueue(encoder.encode(text)); },
    releaseHeld(index) {
      const connection = connections[index];
      for (const text of connection?.held.splice(0) ?? []) connection.controller.enqueue(encoder.encode(text));
    },
    release(index) { pending[index]?.(); },
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith('/v1/realtime/workspaces/')) return realFetch(input, init);
    const index = calls.length;
    const script = scripts[Math.min(index, scripts.length - 1)] ?? {};
    const call = { index, url: url.pathname + url.search, method: init.method ?? 'GET', headers: Object.keys(init.headers ?? {}), aborted: false };
    calls.push(call);
    return new Promise((resolve, reject) => {
      const respond = () => {
        if (call.aborted) return;
        if (script.status >= 400) {
          resolve(new Response(JSON.stringify(script.body ?? {}), { status: script.status, headers: { 'content-type': 'application/json' } }));
          return;
        }
        const connection = { held: [...(script.held ?? [])], controller: null };
        connections[index] = connection;
        const body = new ReadableStream({ start(controller) {
          connection.controller = controller;
          for (const text of script.frames ?? []) controller.enqueue(encoder.encode(text));
          if (script.end) controller.close();
        } });
        resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      };
      init.signal?.addEventListener('abort', () => {
        call.aborted = true;
        try { connections[index]?.controller.close(); } catch { /* Already closed. */ }
        reject(new DOMException('Aborted', 'AbortError'));
      });
      if (script.withhold) pending[index] = respond; else respond();
    });
  };
}
