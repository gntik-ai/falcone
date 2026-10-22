// Only a browser resource diagnostic with the exact URL and injected failure is allowed.
// Application console.error, pageerror and unhandledrejection remain unconditional faults.
export function consumeResourceDiagnostic(text, url, injected) {
  const kind = /^Failed to load resource: the server responded with a status of 500(?: \([^\n]*\))?$/.test(text)
    ? '500' : /^Failed to load resource: net::ERR_FAILED$/.test(text) ? 'network' : null;
  if (!kind) return false;
  const index = injected.findIndex((failure) => failure.url === url && failure.kind === kind);
  if (index < 0) return false;
  injected.splice(index, 1);
  return true;
}
