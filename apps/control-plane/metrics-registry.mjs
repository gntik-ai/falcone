// Zero-dependency Prometheus metrics registry (add-falcone-metrics-scrape-and-dashboards, #499).
//
// In-process counters + a latency histogram for HTTP requests, rendered in the Prometheus text
// exposition format at GET /metrics. HTTP labels come only from the server's static route
// templates or fixed sentinels. No external dependencies.

const requestsTotal = new Map();   // "method|route|status" -> count
const durationByRoute = new Map(); // "method|route" -> { buckets:number[], sum, count }
const knativeDependencyTotal = new Map(); // bounded capability|operation|mode|state|reason|result
const LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const startedAtMs = Date.now();

const esc = (v) => String(v ?? '').replace(/[\\"\n]/g, '_');

// Each HTTP Map has at most 16,384 keys, including a reserved global overflow key.
// This allows roughly 191 templates x 8 methods x 10 statuses before aggregation.
const HTTP_METRIC_KEY_CAP = 16_384;
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER']);
const HTTP_ROUTE_SENTINELS = new Set(['unmatched', 'proxied', 'health', 'root', 'overflow']);
let httpRouteTemplates = new Set();

// Configure once from the server-side route table, never from an incoming request.
export function setHttpRouteTemplates(templates) {
  httpRouteTemplates = new Set(templates);
}

// Record one handled request. durationSeconds is the wall-clock handler time.
export function recordHttp({ method = 'GET', route = 'unmatched', status = 0, durationSeconds = 0 }) {
  if (!HTTP_METHODS.has(method)) method = 'OTHER';
  if (!httpRouteTemplates.has(route) && !HTTP_ROUTE_SENTINELS.has(route)) route = 'unmatched';
  let rk = `${method}|${route}|${status}`;
  let dk = `${method}|${route}`;
  // Reserve one slot in BOTH maps. A single global overflow series cannot itself grow
  // with method/status combinations, and counters/histograms retain every observation.
  if ((!requestsTotal.has(rk) && requestsTotal.size >= HTTP_METRIC_KEY_CAP - 1)
      || (!durationByRoute.has(dk) && durationByRoute.size >= HTTP_METRIC_KEY_CAP - 1)) {
    rk = 'OTHER|overflow|0';
    dk = 'OTHER|overflow';
  }
  requestsTotal.set(rk, (requestsTotal.get(rk) ?? 0) + 1);

  let h = durationByRoute.get(dk);
  if (!h) { h = { buckets: new Array(LE.length).fill(0), sum: 0, count: 0 }; durationByRoute.set(dk, h); }
  h.sum += durationSeconds;
  h.count += 1;
  for (let i = 0; i < LE.length; i++) if (durationSeconds <= LE[i]) h.buckets[i] += 1; // cumulative
}

const KNATIVE_CAPABILITIES = new Set(['function', 'mcp']);
const KNATIVE_OPERATIONS = new Set(['deploy', 'update', 'invoke', 'rollback', 'delete', 'cleanup']);
const KNATIVE_MODES = new Set(['managed', 'external', 'disabled']);
const KNATIVE_STATES = new Set(['ready', 'unverified', 'degraded', 'unavailable', 'disabled']);
const KNATIVE_RESULTS = new Set(['unavailable', 'deferred', 'recovered', 'retry_failed']);
const KNATIVE_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

// Record a dependency transition without tenant- or resource-controlled labels. Tenant/workspace
// correlation belongs in the audit record; keeping it out of Prometheus bounds cardinality.
export function recordKnativeDependencyEvent(event = {}) {
  const capability = KNATIVE_CAPABILITIES.has(event.capability) ? event.capability : 'function';
  const operation = KNATIVE_OPERATIONS.has(event.operation) ? event.operation : 'cleanup';
  const mode = KNATIVE_MODES.has(event.mode) ? event.mode : 'disabled';
  const state = KNATIVE_STATES.has(event.state) ? event.state : 'unavailable';
  const reason = KNATIVE_REASON.test(event.reason ?? '') ? event.reason : 'STATUS_UNAVAILABLE';
  const result = KNATIVE_RESULTS.has(event.result) ? event.result : 'unavailable';
  const key = `${capability}|${operation}|${mode}|${state}|${reason}|${result}`;
  knativeDependencyTotal.set(key, (knativeDependencyTotal.get(key) ?? 0) + 1);
}

// Render the full registry in Prometheus text exposition format.
export function renderMetrics(secretBackend = { state: 'disabled', consecutiveFailures: 0 }) {
  const out = [];
  out.push('# HELP falcone_http_requests_total Total HTTP requests handled.');
  out.push('# TYPE falcone_http_requests_total counter');
  for (const [k, v] of requestsTotal) {
    const [method, route, status] = k.split('|');
    out.push(`falcone_http_requests_total{method="${esc(method)}",route="${esc(route)}",status="${esc(status)}"} ${v}`);
  }
  out.push('# HELP falcone_http_request_duration_seconds HTTP request latency in seconds.');
  out.push('# TYPE falcone_http_request_duration_seconds histogram');
  for (const [k, h] of durationByRoute) {
    const [method, route] = k.split('|');
    const lbl = `method="${esc(method)}",route="${esc(route)}"`;
    for (let i = 0; i < LE.length; i++) out.push(`falcone_http_request_duration_seconds_bucket{${lbl},le="${LE[i]}"} ${h.buckets[i]}`);
    out.push(`falcone_http_request_duration_seconds_bucket{${lbl},le="+Inf"} ${h.count}`);
    out.push(`falcone_http_request_duration_seconds_sum{${lbl}} ${h.sum}`);
    out.push(`falcone_http_request_duration_seconds_count{${lbl}} ${h.count}`);
  }
  out.push('# HELP falcone_process_uptime_seconds Process uptime in seconds.');
  out.push('# TYPE falcone_process_uptime_seconds gauge');
  out.push(`falcone_process_uptime_seconds ${Math.floor((Date.now() - startedAtMs) / 1000)}`);
  out.push('# HELP falcone_secret_backend_auth_degraded Whether backend authentication is degraded.');
  out.push('# TYPE falcone_secret_backend_auth_degraded gauge');
  out.push(`falcone_secret_backend_auth_degraded ${secretBackend.state === 'degraded' ? 1 : 0}`);
  out.push('# HELP falcone_secret_backend_auth_consecutive_failures Consecutive backend authentication failures.');
  out.push('# TYPE falcone_secret_backend_auth_consecutive_failures gauge');
  out.push(`falcone_secret_backend_auth_consecutive_failures ${Number(secretBackend.consecutiveFailures) || 0}`);
  out.push('# HELP falcone_knative_dependency_events_total Knative availability, deferred cleanup, and recovery events.');
  out.push('# TYPE falcone_knative_dependency_events_total counter');
  for (const [key, value] of knativeDependencyTotal) {
    const [capability, operation, mode, state, reason, result] = key.split('|');
    out.push('falcone_knative_dependency_events_total{'
      + `capability="${esc(capability)}",operation="${esc(operation)}",mode="${esc(mode)}",`
      + `state="${esc(state)}",reason="${esc(reason)}",result="${esc(result)}"} ${value}`);
  }
  return out.join('\n') + '\n';
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
