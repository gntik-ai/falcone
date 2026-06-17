// Seed the live Falcone deployment with 2 tenants (companies), each with multiple
// users + projects (workspaces) + PG/Mongo databases + Kafka topics + a data-plane
// API key + registered app end-users. Writes tests/live-campaign/.fixtures.json
// (gitignored — contains API keys / passwords). Run via creds.sh (injects superadmin pw):
//   bash tests/live-campaign/lib/portforward.sh ... ; bash tests/live-campaign/lib/creds.sh node tests/live-campaign/seed.mjs
import { writeFileSync } from 'node:fs';
import { login, ropc, post, get, jwtClaims, api } from './lib/client.mjs';

const log = (...a) => console.log(...a);
const PW = 'CampaignPass!2026';                // shared known test password (throwaway cluster)
const out = { createdAt: new Date().toISOString(), superadmin: {}, tenants: [] };

function pick(o, ...keys) { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; }

async function superadminToken() {
  const u = process.env.FALCONE_SUPERADMIN_USER || 'superadmin';
  const p = process.env.FALCONE_SUPERADMIN_PW;
  let r = await login(u, p);
  if (!r.ok || !r.token) {
    // fallback: direct ROPC against the platform realm
    const cand = ['in-falcone-console', 'in-falcone-gateway', 'admin-cli'];
    for (const c of cand) { const rr = await ropc({ clientId: c, username: u, password: p }); if (rr.ok) { r = { ok: true, token: rr.token, raw: rr.raw }; break; } }
  }
  if (!r.ok || !r.token) { console.error('FATAL: superadmin login failed', r.status, JSON.stringify(r.raw)?.slice(0, 300)); process.exit(1); }
  return r.token;
}

async function seedTenant(token, { slug, displayName }) {
  log(`\n=== tenant ${slug} (${displayName}) ===`);
  const t = { slug, displayName, users: [], workspaces: [] };
  // 1. create tenant (+ owner user in the tenant realm)
  const ownerUser = `owner@${slug}.test`;
  let r = await post('/v1/tenants', {
    displayName, slug,
    ownerUsername: ownerUser, ownerEmail: ownerUser, ownerPassword: PW,
    ownerFirstName: 'Tenant', ownerLastName: 'Owner',
  }, { token });
  log(`  POST /v1/tenants -> ${r.status}`);
  if (r.status >= 300) { log('   body:', JSON.stringify(r.body).slice(0, 300)); }
  t.id = pick(r.body, 'id', 'tenantId') || pick(r.body?.tenant, 'id');
  t.realm = pick(r.body, 'iamRealm', 'realm') || t.id;
  t.owner = { username: ownerUser, password: PW, id: pick(r.body?.owner, 'id') };
  log(`   tenantId=${t.id} realm=${t.realm}`);
  if (!t.id) { log('   !! no tenantId; skipping rest of tenant'); return t; }

  // 2. assign a plan (so quotas/entitlements resolve). Try a couple of common plan ids.
  for (const plan of ['starter', 'free', 'pro', 'enterprise']) {
    const pr = await post(`/v1/tenants/${t.id}/plan`, { planId: plan, planSlug: plan }, { token });
    if (pr.status < 300) { t.plan = plan; log(`   plan=${plan} assigned`); break; }
  }

  // 3. tenant users (besides owner)
  for (const n of ['alice', 'bob']) {
    const ur = await post(`/v1/tenants/${t.id}/users`, { username: `${n}@${slug}.test`, email: `${n}@${slug}.test`, password: PW, firstName: n, lastName: 'User' }, { token });
    log(`   POST users/${n} -> ${ur.status}`);
    if (ur.status < 300) t.users.push({ username: `${n}@${slug}.test`, password: PW, id: pick(ur.body, 'id', 'userId') });
  }

  // 4. workspaces (projects) x2 with resources
  for (const wname of ['app-prod', 'app-staging']) {
    const wr = await post(`/v1/tenants/${t.id}/workspaces`, { displayName: wname, slug: wname, environment: wname.includes('prod') ? 'production' : 'staging' }, { token });
    log(`   POST workspaces/${wname} -> ${wr.status}`);
    const ws = { name: wname, id: pick(wr.body, 'id', 'workspaceId') || pick(wr.body?.workspace, 'id') };
    if (wr.status >= 300) { log('     body:', JSON.stringify(wr.body).slice(0, 250)); }
    if (ws.id) {
      // 4a. provision PG + Mongo databases
      const pg = await post(`/v1/workspaces/${ws.id}/databases`, { engine: 'postgresql' }, { token });
      log(`     PG db -> ${pg.status}`);
      ws.pg = { status: pg.status, database: pick(pg.body, 'database'), connection: pick(pg.body, 'connection') };
      const mo = await post(`/v1/workspaces/${ws.id}/databases`, { engine: 'mongodb' }, { token });
      log(`     Mongo db -> ${mo.status}`);
      ws.mongo = { status: mo.status, body: mo.body };
      // 4b. kafka topic
      const tp = await post(`/v1/events/workspaces/${ws.id}/topics`, { topicName: `${wname}-events`, name: `${wname}-events`, partitions: 1 }, { token });
      log(`     topic -> ${tp.status}`);
      ws.topic = { status: tp.status, id: pick(tp.body, 'resourceId', 'id'), physical: pick(tp.body, 'physicalTopicName') };
      // 4c. data-plane API key (executor route; admin JWT)
      const ak = await post(`/v1/workspaces/${ws.id}/api-keys`, { name: `${wname}-key`, type: 'service', scopes: ['data:read', 'data:write'] }, { token });
      log(`     api-key -> ${ak.status}`);
      ws.apiKey = { status: ak.status, key: pick(ak.body, 'apiKey', 'key', 'secret', 'token'), id: pick(ak.body, 'id', 'keyId') };
      if (ak.status >= 300) log('       body:', JSON.stringify(ak.body).slice(0, 250));
    }
    t.workspaces.push(ws);
  }

  // 5. register an app end-user into the TENANT realm (auth-as-a-service)
  const eu = await post(`/v1/iam/realms/${t.realm}/users`, { username: `enduser@${slug}.test`, email: `enduser@${slug}.test`, enabled: true, credentials: [{ type: 'password', value: PW, temporary: false }] }, { token });
  log(`   app end-user (realm ${t.realm}) -> ${eu.status}`);
  t.appEndUser = { username: `enduser@${slug}.test`, password: PW, status: eu.status, id: pick(eu.body, 'id') };

  return t;
}

(async () => {
  const token = await superadminToken();
  out.superadmin = { claims: jwtClaims(token) };
  log('superadmin token OK; claims roles=', JSON.stringify(out.superadmin.claims?.realm_access?.roles || out.superadmin.claims?.roles || out.superadmin.claims?.actorType));
  for (const tn of [{ slug: 'acme', displayName: 'Acme Inc' }, { slug: 'globex', displayName: 'Globex LLC' }]) {
    out.tenants.push(await seedTenant(token, tn));
  }
  writeFileSync('tests/live-campaign/.fixtures.json', JSON.stringify(out, null, 2));
  log('\n=== wrote tests/live-campaign/.fixtures.json ===');
  log('summary:', out.tenants.map((t) => `${t.slug}:${t.id ? 'OK' : 'FAIL'}(ws=${t.workspaces.filter((w) => w.id).length})`).join('  '));
})().catch((e) => { console.error('seed error', e); process.exit(1); });
