// Empirical capability + isolation tests against the live kind deployment.
// Uses the seeded fixtures (.fixtures.json): superadmin via env, per-tenant ops tokens
// (platform realm, tenant_id) + flc_ API keys. Emits audit/live-campaign/results.json.
import { readFileSync, writeFileSync } from 'node:fs';
const GW = 'http://localhost:9080';
const fx = JSON.parse(readFileSync('tests/live-campaign/.fixtures.json', 'utf8'));
const A = fx.tenants.find(t => t.slug === 'acme');
const B = fx.tenants.find(t => t.slug === 'globex');
const results = [];
const rec = (cap, name, pass, detail) => { results.push({ cap, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} [${cap}] ${name} :: ${detail}`); };

async function login(u) { const r = await fetch(GW + '/v1/auth/login-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'CampaignPass!2026' }) }); return (await r.json()).tokenSet?.accessToken; }
async function call(method, path, { token, apikey, body } = {}) {
  const h = { 'X-Correlation-Id': 'camp', 'Idempotency-Key': 'i' + Math.floor(performance.now()) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (apikey) h.apikey = apikey;
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(GW + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let b; const ct = r.headers.get('content-type') || ''; b = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
  return { status: r.status, body: b };
}

(async () => {
  const SU = await (async () => { const r = await fetch(GW + '/v1/auth/login-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.FALCONE_SUPERADMIN_USER || 'superadmin', password: process.env.FALCONE_SUPERADMIN_PW }) }); return (await r.json()).tokenSet?.accessToken; })();
  A.opsToken = await login('acme-ops'); B.opsToken = await login('globex-ops');
  const aKey = A.workspaces.find(w => w.apiKey?.key)?.apiKey.key;
  const bKey = B.workspaces.find(w => w.apiKey?.key)?.apiKey.key;
  const aWs = A.workspaces.find(w => w.id)?.id, bWs = B.workspaces.find(w => w.id)?.id;
  const aDb = A.workspaces.find(w => w.id)?.db?.database, bDb = B.workspaces.find(w => w.id)?.db?.database;
  const dbName = (d) => d?.name || d?.databaseName || d?.logicalName || d?.id;

  // ---- capability smoke (owner/superadmin happy-path) ----
  let r;
  r = await call('GET', '/v1/tenants', { token: SU }); rec('tenant-lifecycle', 'list tenants (superadmin)', r.status === 200 && Array.isArray(r.body) && r.body.length >= 2, `status=${r.status} count=${Array.isArray(r.body) ? r.body.length : '?'}`);
  r = await call('GET', `/v1/tenants/${A.id}`, { token: A.opsToken }); rec('tenant-lifecycle', 'get own tenant (acme-ops)', r.status === 200, `status=${r.status}`);
  r = await call('GET', `/v1/tenants/${A.id}/workspaces`, { token: A.opsToken }); rec('workspace-lifecycle', 'list own workspaces', r.status === 200, `status=${r.status} count=${Array.isArray(r.body) ? r.body.length : JSON.stringify(r.body).slice(0,60)}`);
  r = await call('GET', '/v1/plans', { token: SU }); rec('quotas-plans', 'list plans (superadmin)', r.status === 200, `status=${r.status}`);
  r = await call('GET', `/v1/metrics/tenants/${A.id}/quotas`, { token: A.opsToken }); rec('metrics', 'tenant quotas', r.status === 200, `status=${r.status} body=${JSON.stringify(r.body).slice(0,80)}`);
  r = await call('GET', '/v1/storage/buckets', { token: A.opsToken }); rec('storage', 'list buckets', r.status === 200, `status=${r.status}`);
  r = await call('GET', `/v1/events/workspaces/${aWs}/inventory`, { token: A.opsToken }); rec('events', 'events inventory', r.status === 200, `status=${r.status}`);
  r = await call('GET', `/v1/functions/workspaces/${aWs}/inventory`, { token: A.opsToken }); rec('functions', 'functions inventory', r.status === 200, `status=${r.status}`);
  r = await call('GET', '/v1/postgres/databases', { token: A.opsToken }); rec('postgres-data-api', 'pg databases browse', r.status === 200, `status=${r.status}`);
  r = await call('GET', '/v1/mongo/databases', { token: A.opsToken }); rec('mongo-data-api', 'mongo databases browse', r.status === 200, `status=${r.status}`);

  // ---- data-plane via API key (executor) ----
  if (aKey && aDb) {
    const db = dbName(aDb);
    // create schema + table (DDL)
    r = await call('POST', `/v1/postgres/databases/${db}/schemas`, { apikey: aKey, body: { name: 'app' } });
    rec('postgres-data-api', 'DDL create schema (apikey)', r.status < 300 || r.status === 409, `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
    r = await call('POST', `/v1/postgres/databases/${db}/schemas/app/tables`, { apikey: aKey, body: { name: 'items', columns: [{ name: 'id', type: 'serial', primaryKey: true }, { name: 'label', type: 'text' }] } });
    rec('postgres-data-api', 'DDL create table (apikey)', r.status < 300 || r.status === 409, `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
    r = await call('POST', `/v1/postgres/workspaces/${aWs}/data/${db}/schemas/app/tables/items/rows`, { apikey: aKey, body: { label: 'hello' } });
    rec('postgres-data-api', 'insert row (apikey)', r.status < 300, `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
    r = await call('GET', `/v1/postgres/workspaces/${aWs}/data/${db}/schemas/app/tables/items/rows`, { apikey: aKey });
    rec('postgres-data-api', 'list rows (apikey)', r.status === 200, `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
    // mongo doc
    r = await call('POST', `/v1/mongo/workspaces/${aWs}/data/appdb/collections/things/documents`, { apikey: aKey, body: { hi: 'there', n: 1 } });
    rec('mongo-data-api', 'insert document (apikey)', r.status < 300, `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
    r = await call('GET', `/v1/mongo/workspaces/${aWs}/data/appdb/collections/things/documents`, { apikey: aKey });
    rec('mongo-data-api', 'list documents (apikey)', r.status === 200, `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
    // events publish
    const topic = A.workspaces.find(w => w.id)?.topic;
    r = await call('POST', `/v1/events/workspaces/${aWs}/topics`, { apikey: aKey, body: { topicName: 'camp-topic', name: 'camp-topic', partitions: 1 } });
    rec('events', 'create topic (apikey)', r.status < 300 || r.status === 409, `status=${r.status} ${JSON.stringify(r.body).slice(0,80)}`);
  } else rec('postgres-data-api', 'data-plane prerequisites', false, `aKey=${!!aKey} aDb=${!!aDb}`);

  // ---- ISOLATION (Phase 3) — cross-tenant must be denied ----
  r = await call('GET', `/v1/tenants/${B.id}`, { token: A.opsToken }); rec('isolation', 'acme-ops GET globex tenant', [403, 404].includes(r.status), `status=${r.status} (expect 403/404)`);
  r = await call('GET', `/v1/tenants/${B.id}/workspaces`, { token: A.opsToken }); rec('isolation', 'acme-ops list globex workspaces', [403, 404].includes(r.status), `status=${r.status} (expect 403/404)`);
  r = await call('GET', `/v1/tenants/${B.id}/plan/effective-entitlements`, { token: A.opsToken }); rec('isolation', 'acme-ops globex entitlements', [403, 404].includes(r.status), `status=${r.status} (expect 403/404)`);
  if (aKey && bWs) { r = await call('GET', `/v1/postgres/workspaces/${bWs}/data/postgres/schemas/public/tables/x/rows`, { apikey: aKey }); rec('isolation', 'acme apikey -> globex workspace data', [401, 403, 404].includes(r.status), `status=${r.status} (expect deny)`); }
  if (aKey && bWs) { r = await call('POST', `/v1/workspaces/${bWs}/api-keys`, { token: A.opsToken, body: { name: 'x' } }); rec('isolation', 'acme-ops issue key in globex ws', [401, 403, 404].includes(r.status), `status=${r.status} (expect deny)`); }
  r = await call('GET', `/v1/metrics/tenants/${B.id}/quotas`, { token: A.opsToken }); rec('isolation', 'acme-ops globex metrics', [403, 404].includes(r.status), `status=${r.status} (expect 403/404)`);

  // ---- P0 isolation breaches fixed this campaign (epic #539) ----
  // ISO-EVENTS (#547): acme-ops must not read/publish/consume globex's topic.
  const bTopic = B.workspaces.find(w => w.topic?.id)?.topic?.id;
  if (bTopic) {
    r = await call('GET', `/v1/events/topics/${bTopic}`, { token: A.opsToken }); rec('isolation', 'ISO-EVENTS acme-ops GET globex topic', [403, 404].includes(r.status), `status=${r.status} (expect 403/404)`);
    r = await call('POST', `/v1/events/topics/${bTopic}/publish`, { token: A.opsToken, body: { payload: { evil: true } } }); rec('isolation', 'ISO-EVENTS acme-ops publish to globex topic', [403, 404].includes(r.status), `status=${r.status} (expect 403/404; never 202)`);
  } else rec('isolation', 'ISO-EVENTS prerequisites', false, 'no globex topic id in fixtures');
  // ISO-METRICS (#549): acme-ops must not read globex workspace metrics.
  if (bWs) {
    r = await call('GET', `/v1/metrics/workspaces/${bWs}/series`, { token: A.opsToken }); rec('isolation', 'ISO-METRICS acme-ops globex workspace series', [403, 404].includes(r.status), `status=${r.status} (expect 403)`);
    r = await call('GET', `/v1/metrics/workspaces/${bWs}/overview`, { token: A.opsToken }); rec('isolation', 'ISO-METRICS acme-ops globex workspace overview', [403, 404].includes(r.status), `status=${r.status} (expect 403)`);
  }
  // ISO-MONGO (#550): acme-ops must not read globex's documents via the browse route.
  if (bWs) {
    r = await call('GET', `/v1/mongo/workspaces/${bWs}/data/appdb/collections/things/documents`, { token: A.opsToken });
    const leaked = JSON.stringify(r.body ?? '').includes('GLOBEX');
    rec('isolation', 'ISO-MONGO acme-ops read globex documents', ([403, 404].includes(r.status) || (r.status === 200 && (r.body?.items?.length ?? 0) === 0)) && !leaked, `status=${r.status} leaked=${leaked} (expect 404 or empty)`);
  }
  // ISO-FUNCTIONS (#548) is structurally fixed (per-(tenant,workspace) ksvc name);
  // the distinct-ksvc contract is covered by tests/blackbox/functions-ksvc-tenant-namespacing.test.mjs.

  const pass = results.filter(x => x.pass).length;
  writeFileSync('audit/live-campaign/results.json', JSON.stringify({ when: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  console.log(`\n=== ${pass}/${results.length} passed; wrote audit/live-campaign/results.json ===`);
})().catch(e => { console.error('runner error', e); process.exit(1); });
