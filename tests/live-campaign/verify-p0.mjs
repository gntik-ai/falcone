// Live P0 isolation verification (epic #539: ISO-EVENTS/METRICS/MONGO/FUNCTIONS).
// Run identically against the pre-fix and post-fix control-plane image:
//   pre-fix  -> expect BREACHES (cross-tenant access succeeds)
//   post-fix -> expect SECURE   (cross-tenant access denied; own access intact)
//
// Attacker = acme-ops (platform-realm operator, tenant_id=acme, tenant_owner).
// Victim   = globex. Ground-truth ids resolved from the live cluster.
import { readFileSync } from 'node:fs';

const GW = process.env.FALCONE_GATEWAY || 'http://localhost:9080';
const PW = process.env.CAMPAIGN_PW || 'CampaignPass!2026';
const RUN_FUNCTIONS = process.env.RUN_FUNCTIONS !== '0';
const fx = JSON.parse(readFileSync('tests/live-campaign/.fixtures.json', 'utf8'));
const A = fx.tenants.find((t) => t.slug === 'acme');
const B = fx.tenants.find((t) => t.slug === 'globex');

// Ground truth (verified against control-plane DB; both tenants have app-staging).
const A_WS = '928534a8-bc3c-4606-80e7-3862685abd04';      // acme app-staging
const B_WS = 'cc38c85c-739a-4064-b745-bc958f8e2bc6';      // globex app-staging
const B_TOPIC = 'res_topic_3d1fe56b';                      // globex topic
const A_KEY = (A.workspaces.find((w) => w.id === A_WS)?.apiKey || {}).key;
const B_KEY = (B.workspaces.find((w) => w.id === B_WS)?.apiKey || {}).key;
const COL = 'p0probe';

let nonce = 0;
async function login(u) {
  const r = await fetch(GW + '/v1/auth/login-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: PW }) });
  return (await r.json()).tokenSet?.accessToken;
}
async function call(method, path, { token, apikey, body, timeout = 15000 } = {}) {
  const h = { 'X-Correlation-Id': 'p0', 'Idempotency-Key': 'i' + (++nonce) + '-' + Math.floor(performance.now()) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (apikey) h.apikey = apikey;
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(GW + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  const ct = r.headers.get('content-type') || '';
  const b = ct.includes('json') ? await r.json().catch(() => null) : await r.text();
  return { status: r.status, body: b };
}
const blob = (x) => JSON.stringify(x ?? '');

const out = [];
function rec(id, name, secure, detail) {
  out.push({ id, name, secure, detail });
  console.log(`${secure ? '✅ SECURE' : '🔴 BREACH'}  [${id}] ${name} :: ${detail}`);
}
function ctrl(id, name, ok, detail) {
  out.push({ id, name, control: true, ok, detail });
  console.log(`${ok ? '🟢 OK    ' : '⚠️  FAIL '}  [${id}] ${name} :: ${detail}`);
}

(async () => {
  const aOps = await login('acme-ops');
  const bOps = await login('globex-ops');
  if (!aOps || !bOps) { console.error('login failed', { aOps: !!aOps, bOps: !!bOps }); process.exit(2); }
  if (!A_KEY || !B_KEY) { console.error('missing api keys in fixtures'); process.exit(2); }

  // Seed a tenant-marked document for each tenant (idempotent enough for a probe).
  let s;
  s = await call('POST', `/v1/mongo/workspaces/${A_WS}/data/appdb/collections/${COL}/documents`, { apikey: A_KEY, body: { marker: 'ACME_PRIVATE', n: 1 } });
  console.log(`seed acme doc -> ${s.status}`);
  s = await call('POST', `/v1/mongo/workspaces/${B_WS}/data/appdb/collections/${COL}/documents`, { apikey: B_KEY, body: { marker: 'GLOBEX_PRIVATE', n: 1 } });
  console.log(`seed globex doc -> ${s.status}`);

  console.log('\n--- ISO-EVENTS (#547): acme-ops vs globex topic ---');
  let r;
  r = await call('GET', `/v1/events/topics/${B_TOPIC}`, { token: aOps });
  rec('ISO-EVENTS-detail', 'acme-ops GET globex topic detail', [403, 404].includes(r.status), `status=${r.status}`);
  r = await call('POST', `/v1/events/topics/${B_TOPIC}/publish`, { token: aOps, body: { payload: { evil: true } } });
  rec('ISO-EVENTS-publish', 'acme-ops publish into globex topic', [403, 404].includes(r.status), `status=${r.status} (202=injected)`);
  r = await call('GET', `/v1/events/topics/${B_TOPIC}/metadata`, { token: aOps });
  rec('ISO-EVENTS-meta', 'acme-ops GET globex topic metadata', [403, 404].includes(r.status), `status=${r.status}`);

  console.log('\n--- ISO-METRICS (#549): acme-ops vs globex metrics ---');
  r = await call('GET', `/v1/metrics/workspaces/${B_WS}/series`, { token: aOps });
  rec('ISO-METRICS-series', 'acme-ops GET globex workspace series', [403, 404].includes(r.status), `status=${r.status} pts=${(r.body?.points?.length ?? '?')}`);
  r = await call('GET', `/v1/metrics/workspaces/${B_WS}/overview`, { token: aOps });
  rec('ISO-METRICS-overview', 'acme-ops GET globex workspace overview', [403, 404].includes(r.status), `status=${r.status}`);
  r = await call('GET', `/v1/metrics/tenants/${B.id}/quotas`, { token: aOps });
  rec('ISO-METRICS-tenant', 'acme-ops GET globex tenant quotas', [403, 404].includes(r.status), `status=${r.status}`);

  console.log('\n--- ISO-MONGO (#550): acme-ops vs globex documents ---');
  r = await call('GET', `/v1/mongo/workspaces/${B_WS}/data/appdb/collections/${COL}/documents`, { token: aOps });
  const mongoLeak = blob(r.body).includes('GLOBEX_PRIVATE');
  rec('ISO-MONGO-docs', 'acme-ops read globex documents', !mongoLeak && ([403, 404].includes(r.status) || (r.status === 200 && (r.body?.items?.length ?? 0) === 0)), `status=${r.status} leaked=${mongoLeak} items=${r.body?.items?.length ?? '?'}`);

  console.log('\n--- positive controls (legitimate access must keep working) ---');
  r = await call('GET', `/v1/events/topics/${B_TOPIC}`, { token: bOps });
  ctrl('CTRL-EVENTS', 'globex-ops reads its OWN topic', r.status === 200, `status=${r.status}`);
  r = await call('GET', `/v1/metrics/workspaces/${B_WS}/overview`, { token: bOps });
  ctrl('CTRL-METRICS', 'globex-ops reads its OWN metrics', r.status === 200, `status=${r.status}`);
  r = await call('GET', `/v1/mongo/workspaces/${B_WS}/data/appdb/collections/${COL}/documents`, { token: bOps });
  ctrl('CTRL-MONGO-B', 'globex-ops reads its OWN docs', r.status === 200 && blob(r.body).includes('GLOBEX_PRIVATE'), `status=${r.status} sawGlobex=${blob(r.body).includes('GLOBEX_PRIVATE')}`);
  r = await call('GET', `/v1/mongo/workspaces/${A_WS}/data/appdb/collections/${COL}/documents`, { token: aOps });
  ctrl('CTRL-MONGO-A', 'acme-ops reads its OWN docs (no globex)', r.status === 200 && blob(r.body).includes('ACME_PRIVATE') && !blob(r.body).includes('GLOBEX_PRIVATE'), `status=${r.status} sawAcme=${blob(r.body).includes('ACME_PRIVATE')} sawGlobex=${blob(r.body).includes('GLOBEX_PRIVATE')}`);

  if (RUN_FUNCTIONS) {
    console.log('\n--- ISO-FUNCTIONS (#548): same action name in both tenants app-staging (Knative cold start ~90s) ---');
    // fn-runtime expects OpenWhisk nodejs convention (exports.main / global main), NOT ESM export.
    const src = (who) => `exports.main = function(){ return { owner: '${who}' }; };`;
    const dA = await call('POST', '/v1/functions/actions', { token: aOps, body: { workspaceId: A_WS, actionName: COL, source: { inlineCode: src('ACME') } } });
    const dB = await call('POST', '/v1/functions/actions', { token: bOps, body: { workspaceId: B_WS, actionName: COL, source: { inlineCode: src('GLOBEX') } } });
    const aId = dA.body?.resourceId; const bId = dB.body?.resourceId;
    console.log(`deploy acme=${dA.status}(${aId}) globex=${dB.status}(${bId})`);
    if (aId && bId) {
      // Invoke acme's function; in the pre-fix shared-ksvc state globex's deploy clobbers it.
      const inv = await call('POST', `/v1/functions/actions/${aId}/invocations`, { token: aOps, body: { parameters: {} }, timeout: 180000 });
      const actId = inv.body?.invocationId;
      let res = null;
      if (actId) {
        for (let i = 0; i < 30; i++) {
          const rr = await call('GET', `/v1/functions/actions/${aId}/activations/${actId}/result`, { token: aOps });
          if (rr.status === 200) { res = rr.body; break; }
          await new Promise((x) => setTimeout(x, 2000));
        }
      }
      const owner = res?.result?.owner;
      rec('ISO-FUNCTIONS', 'acme invoke returns ACME code (not globex)', owner === 'ACME', `invoke=${inv.status} owner=${owner ?? blob(res).slice(0, 80)}`);
    } else {
      ctrl('ISO-FUNCTIONS', 'deploy prerequisites', false, `acme=${dA.status} globex=${dB.status}`);
    }
  }

  const breaches = out.filter((x) => !x.control && !x.secure);
  const ctrlFails = out.filter((x) => x.control && !x.ok);
  console.log(`\n=== ${breaches.length} BREACH(es), ${ctrlFails.length} control failure(s) ===`);
  if (breaches.length) console.log('BREACHES:', breaches.map((b) => b.id).join(', '));
})().catch((e) => { console.error('runner error', e); process.exit(1); });
