// add-falcone-metrics-scrape-and-dashboards (#499): the control-plane/executor expose a Prometheus
// /metrics endpoint backed by this zero-dep registry. Pure unit coverage of recording + rendering +
// static route allowlisting, bounded methods, and registry saturation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordHttp, renderMetrics, setHttpRouteTemplates, METRICS_CONTENT_TYPE } from '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';

for (const service of ['control-plane', 'control-plane-executor/src/runtime']) {
  test(`${service}: arbitrary request paths cannot inject metric labels`, async () => {
    const registry = await import(`../../apps/${service}/metrics-registry.mjs?raw-path-regression`);
    for (let i = 0; i < 10; i++) {
      registry.recordHttp({ method: 'GET', route: `/v1/f0-inject-${i}/xyz`, status: 404, durationSeconds: 0.01 });
    }
    const text = registry.renderMetrics();
    assert.doesNotMatch(text, /f0-inject-/);
    assert.match(text, /falcone_http_requests_total\{method="GET",route="unmatched",status="404"\} 10/);
    assert.equal(text.split('\n').filter((line) => line.startsWith('falcone_http_')).length, 15);
  });

  test(`${service}: methods are bounded, and static templates and sentinels survive unchanged`, async () => {
    const registry = await import(`../../apps/${service}/metrics-registry.mjs?bounded-methods`);
    const template = '/v1/tenants/{tenantId}/quota/effective-limits';
    registry.setHttpRouteTemplates([template]);
    registry.recordHttp({ method: 'FOO', route: template, status: 401, durationSeconds: 0.01 });
    registry.recordHttp({ method: 'f0-inject-method', route: template, status: 401, durationSeconds: 0.02 });
    const text = registry.renderMetrics();
    assert.ok(text.includes(`falcone_http_requests_total{method="OTHER",route="${template}",status="401"} 2`));
    assert.ok(!text.includes('FOO') && !text.includes('f0-inject-method'));
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      for (const route of ['unmatched', 'proxied', 'health', 'root', 'overflow']) {
        registry.recordHttp({ method, route, status: 200 });
        assert.ok(registry.renderMetrics().includes(`method="${method}",route="${route}",status="200"} 1`));
      }
    }
  });

  for (const dimension of ['route', 'status']) {
    test(`${service}: ${dimension} saturation overflows without growing either metric family`, async () => {
      const registry = await import(`../../apps/${service}/metrics-registry.mjs?cap-${dimension}`);
      const templates = Array.from({ length: dimension === 'route' ? 17000 : 4300 }, (_, i) => `/static-route-${i}`);
      registry.setHttpRouteTemplates(templates);
      for (const route of templates) {
        for (const status of dimension === 'route' ? [200] : [200, 400, 401, 500]) {
          registry.recordHttp({ method: 'GET', route, status, durationSeconds: 0.125 });
        }
      }
      // Existing keys still count once full; overflow also retains observations.
      registry.recordHttp({ method: 'GET', route: '/static-route-0', status: 200, durationSeconds: 0.125 });
      const lines = registry.renderMetrics().split('\n');
      const counters = lines.filter((line) => line.startsWith('falcone_http_requests_total{'));
      const histograms = lines.filter((line) => line.startsWith('falcone_http_request_duration_seconds_count{'));
      assert.ok(counters.length <= 16384, `counter keys: ${counters.length}`);
      assert.ok(histograms.length <= 16384, `histogram keys: ${histograms.length}`);
      assert.ok(counters.some((line) => line.includes('route="overflow"')));
      assert.ok(histograms.some((line) => line.includes('route="overflow"')));
      assert.ok(counters.includes('falcone_http_requests_total{method="GET",route="/static-route-0",status="200"} 2'));
      const total = (samples) => samples.reduce((sum, line) => sum + Number(line.split(' ').at(-1)), 0);
      assert.equal(total(counters), dimension === 'route' ? 17001 : 17201);
      assert.equal(total(histograms), dimension === 'route' ? 17001 : 17201);
      assert.equal(total(lines.filter((line) => line.startsWith('falcone_http_request_duration_seconds_sum{'))),
        dimension === 'route' ? 2125.125 : 2150.125);
    });
  }
}

test('recordHttp + renderMetrics emit counter + histogram in Prometheus text format', () => {
  setHttpRouteTemplates(['/v1/tenants']);
  recordHttp({ method: 'GET', route: '/v1/tenants', status: 200, tenantId: 'ten-a', durationSeconds: 0.012 });
  recordHttp({ method: 'GET', route: '/v1/tenants', status: 200, tenantId: 'ten-a', durationSeconds: 0.4 });
  recordHttp({ method: 'POST', route: '/v1/tenants', status: 500, tenantId: '', durationSeconds: 1.2 });
  const text = renderMetrics();

  assert.match(text, /# TYPE falcone_http_requests_total counter/);
  assert.match(text, /falcone_http_requests_total\{method="GET",route="\/v1\/tenants",status="200"\} 2/);
  assert.match(text, /falcone_http_requests_total\{method="POST",route="\/v1\/tenants",status="500"\} 1/);
  assert.match(text, /# TYPE falcone_http_request_duration_seconds histogram/);
  assert.match(text, /falcone_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/tenants",le="\+Inf"\} 2/);
  assert.match(text, /falcone_http_request_duration_seconds_count\{method="GET",route="\/v1\/tenants"\} 2/);
  assert.match(text, /falcone_process_uptime_seconds \d+/);
});

test('histogram buckets are cumulative (le ordering holds)', () => {
  // The GET /v1/tenants observations were 0.012s and 0.4s → le=0.025 has 1, le=0.5 has 2.
  const text = renderMetrics();
  const le025 = text.match(/falcone_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/tenants",le="0\.025"\} (\d+)/);
  const le05 = text.match(/falcone_http_request_duration_seconds_bucket\{method="GET",route="\/v1\/tenants",le="0\.5"\} (\d+)/);
  assert.ok(Number(le025[1]) <= Number(le05[1]), 'cumulative buckets non-decreasing');
});

test('exposes the Prometheus text content-type', () => {
  assert.match(METRICS_CONTENT_TYPE, /text\/plain/);
});
