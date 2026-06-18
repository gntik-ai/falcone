// Live #563 (db.query activity wiring) + #564 (event-trigger) end-to-end probe.
// Flows API is executor-direct (gateway has no /v1/flows route): EXEC=:18082.
// Token minted via the gateway console flow (:9080). Ops fixture acme-ops.
import { login } from './lib/client.mjs';

const EXEC = process.env.FALCONE_EXEC || 'http://localhost:18082';
const WS = 'a1788efd-6a78-43de-b4ab-2c3ccd8713b2'; // acme app-prod
const DB = 'wsdb_acme_app_prod';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const r = await login('acme-ops', 'CampaignPass!2026');
if (!r.ok) { console.log('login failed', r.status); process.exit(1); }
const H = { Authorization: `Bearer ${r.token}`, 'Content-Type': 'application/json', 'X-Correlation-Id': 'p1-flows' };
const X = async (m, p, b) => {
  const res = await fetch(`${EXEC}${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json().catch(() => null) : await res.text() };
};
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

// ---- #563: db.query flow executes (not "postgres executor not wired") ----
{
  const def = { apiVersion: 'v1.0', name: 'p1-dbq', nodes: [
    { id: 's1', type: 'task', taskType: 'db.query', params: { engine: 'postgres', operation: 'insert', workspaceId: WS, databaseName: DB, schemaName: 'public', tableName: 'p1_probe_rows', values: { label: 'wired-ok' } } },
  ] };
  const cr = await X('POST', `/v1/flows/workspaces/${WS}/flows`, { name: 'p1-dbq', definition: def });
  const flowId = cr.body?.flowId || cr.body?.id || cr.body?.flow?.id;
  ok('#563 create db.query flow', cr.status === 201 && !!flowId, `status=${cr.status} flowId=${flowId}`);
  if (flowId) {
    const pv = await X('POST', `/v1/flows/workspaces/${WS}/flows/${flowId}/versions`);
    const ver = pv.body?.version ?? pv.body?.versionNumber ?? 1;
    ok('#563 publish version', pv.status === 201, `status=${pv.status} v=${ver}`);
    const ex = await X('POST', `/v1/flows/workspaces/${WS}/flows/${flowId}/executions`, { version: ver, input: {} });
    ok('#563 start execution', ex.status === 201, `status=${ex.status}`);
    const exId = ex.body?.executionId || ex.body?.id;
    let last = null;
    for (let i = 0; i < 15 && exId; i++) {
      await sleep(2000);
      const g = await X('GET', `/v1/flows/workspaces/${WS}/flows/${flowId}/executions/${encodeURIComponent(exId)}`);
      last = g.body; const st = (g.body?.status?.name || g.body?.status || '').toString();
      if (/Completed|Failed|Terminated|Canceled/i.test(st)) break;
    }
    const st = (last?.status?.name || last?.status || '').toString();
    const detail = JSON.stringify(last?.failure || last?.error || last?.result || '').slice(0, 200);
    const notWired = /not wired/i.test(detail);
    ok('#563 db.query activity is WIRED (execution not "postgres executor not wired")',
      !notWired && /Completed|Failed/i.test(st), `status=${st} detail=${detail}`);
    if (st === 'Completed') console.log('     (execution COMPLETED — full data op succeeded)');
    else if (!notWired) console.log('     (executor was reached — failure is a real DB error, NOT the "not wired" defect)');
  }
}

// ---- #564: platform-event trigger binds + (best-effort) fires a flow ----
{
  const ET = 'p1trig';
  const def = { apiVersion: 'v1.0', name: 'p1-evt', triggers: [{ kind: 'platform-event', eventType: ET }],
    nodes: [{ id: 'n1', type: 'task', taskType: 'db.query', params: { engine: 'postgres', operation: 'list', workspaceId: WS, databaseName: DB, schemaName: 'public', tableName: 'p1_probe_rows' } }] };
  const cr = await X('POST', `/v1/flows/workspaces/${WS}/flows`, { name: 'p1-evt', definition: def });
  const flowId = cr.body?.flowId || cr.body?.id;
  ok('#564 create platform-event-trigger flow', cr.status === 201 && !!flowId, `status=${cr.status}`);
  if (flowId) {
    const pv = await X('POST', `/v1/flows/workspaces/${WS}/flows/${flowId}/versions`);
    ok('#564 publish version (binds the trigger consumer)', pv.status === 201, `status=${pv.status} bound=${JSON.stringify(pv.body?.topicRef||pv.body?.triggers||'').slice(0,80)}`);
    // provision the topic + publish a matching event
    await X('POST', `/v1/events/workspaces/${WS}/topics`, { topic: ET, name: ET });
    const pubP = await X('POST', `/v1/events/workspaces/${WS}/topics/${ET}/publish`, { value: { n: 7 } });
    ok('#564 publish matching event', pubP.status === 202 || pubP.status === 200, `status=${pubP.status}`);
    let started = 0;
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      const ls = await X('GET', `/v1/flows/workspaces/${WS}/flows/${flowId}/executions`);
      started = (ls.body?.items || ls.body?.executions || []).length;
      if (started > 0) break;
    }
    ok('#564 published event started a bound flow execution', started > 0, `executions=${started}`);
  }
}

console.log(`\n=== verify-p1-flows: ${pass} pass, ${fail} fail ===`);
