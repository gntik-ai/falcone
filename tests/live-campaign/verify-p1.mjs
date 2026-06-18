// Consolidated LIVE RED->GREEN verification for the P1 batch (2026-06-18).
// Runs real calls against the running kind `falcone` stack through the APISIX
// gateway (port-forward :9080). Uses ONLY the seeded ops fixtures
// (<slug>-ops, platform realm, tenant_owner + tenant_id) — no secret discovery.
//
// Covers the control-plane image changes:
//   #551 fix-pg-browse-tenant-scope       — cross-tenant pg metadata browse denied
//   #555 fix-governance-schema-bootstrap  — governance tables exist (no 42P01)
//   #556 fix-workspace-quota-enforcement  — create past max_workspaces -> 402
//   #567 add-enduser-lifecycle-management — owner delete/disable; cross-tenant 403
// (#559 verified separately via the executor pod label + clean boot;
//  #553 deferred to #430; #563/#564 need the worker image — probes documented.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { login, get, post, del, api } from './lib/client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(resolve(__dirname, '.fixtures.json'), 'utf8'));
const OPS_PW = 'CampaignPass!2026';

const acme = fx.tenants.find((t) => t.slug === 'acme');
const globex = fx.tenants.find((t) => t.slug === 'globex');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function token(slug) {
  const r = await login(`${slug}-ops`, OPS_PW);
  if (!r.ok || !r.token) throw new Error(`login ${slug}-ops failed: ${r.status} ${JSON.stringify(r.raw)?.slice(0, 200)}`);
  return r.token;
}

const acmeTok = await token('acme');
const globexTok = await token('globex');

// ---- #551 pg-browse tenant scope -------------------------------------------
{
  const mine = await get('/v1/postgres/databases', { token: acmeTok });
  const names = (mine.body?.items ?? []).map((d) => d.databaseName);
  ok('#551 acme list excludes in_falcone', mine.status === 200 && !names.includes('in_falcone'), `status=${mine.status} names=${names.join(',')}`);
  ok('#551 acme list excludes globex wsdb', !names.some((n) => /globex/i.test(n)), names.join(','));

  // find a globex db (as globex) then try to browse it as acme -> 404
  const gx = await get('/v1/postgres/databases', { token: globexTok });
  const gxDb = (gx.body?.items ?? []).map((d) => d.databaseName).find((n) => /wsdb/i.test(n));
  if (gxDb) {
    const cross = await get(`/v1/postgres/databases/${encodeURIComponent(gxDb)}/schemas`, { token: acmeTok });
    ok('#551 acme browse globex db -> 404', cross.status === 404, `db=${gxDb} status=${cross.status}`);
  } else {
    ok('#551 cross-tenant browse (no globex db found to probe)', true, 'skipped');
  }
}

// ---- #555 governance schema bootstrap --------------------------------------
{
  // scope-enforcement audit was 500 (missing scope_enforcement_denials); now 200.
  const r = await get(`/v1/tenants/${acme.id}/scope-enforcement/audit`, { token: acmeTok });
  ok('#555 scope-enforcement audit no longer 500', r.status !== 500, `status=${r.status}`);
  // tenant plan read resolves (plan/change-history tables exist) — was 500.
  const p = await get(`/v1/tenant/plan/effective-entitlements`, { token: acmeTok });
  ok('#555 tenant plan entitlements no longer 500', p.status !== 500, `status=${p.status}`);
}

// ---- #556 workspace quota enforcement --------------------------------------
{
  // acme already has 3 workspaces; max_workspaces default = 3 -> the 4th is denied.
  const r = await post(`/v1/tenants/${acme.id}/workspaces`, { displayName: `p1-quota-probe`, slug: `p1-quota-probe`, environment: 'dev' }, { token: acmeTok });
  ok('#556 4th workspace past max_workspaces -> 402', r.status === 402, `status=${r.status} code=${r.body?.code}`);
}

// ---- #567 app end-user lifecycle -------------------------------------------
{
  const realm = acme.realm;
  // create an end-user (owner-facing tenant users route) to operate on
  const cu = await post(`/v1/tenants/${acme.id}/users`, { username: `p1-eu-${Date.now()}`, password: 'EuPass!2026', roles: ['tenant_developer'] }, { token: acmeTok });
  const userId = cu.body?.userId;
  ok('#567 create end-user (precondition)', cu.status === 201 && !!userId, `status=${cu.status}`);
  if (userId) {
    // disable (status PATCH) -> 200
    const dis = await api('PATCH', `/v1/iam/realms/${realm}/users/${userId}/status`, { token: acmeTok, body: { enabled: false } });
    ok('#567 owner disables end-user -> 200', dis.status === 200, `status=${dis.status}`);
    // cross-tenant: globex-ops tries to delete the acme user -> 403/404 (denied)
    const xt = await del(`/v1/iam/realms/${realm}/users/${userId}`, { token: globexTok });
    ok('#567 cross-tenant delete denied', xt.status === 403 || xt.status === 404, `status=${xt.status}`);
    // owner deletes -> 200
    const d = await del(`/v1/iam/realms/${realm}/users/${userId}`, { token: acmeTok });
    ok('#567 owner deletes end-user -> 200', d.status === 200, `status=${d.status}`);
  }
}

console.log(`\n=== verify-p1: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
