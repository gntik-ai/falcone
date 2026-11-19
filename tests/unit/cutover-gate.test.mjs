import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gate = join(repoRoot, 'scripts/release/cutover-gate.mjs');
const committedEvidence = join(repoRoot, 'release-evidence/cutover-gate.json');
const committedRollback = join(repoRoot, 'release-evidence/web-console-rollback.json');

const goodRollback = {
  image: 'ghcr.io/gntik-ai/in-falcone-web-console',
  prior: {
    tag: 'sha-ca5183d',
    digest: `sha256:${'a'.repeat(64)}`,
    source: 'running pods imageID and the registry manifest',
    verified_on: '2026-11-19'
  },
  switch_release: { digest: null }
};

function entry(item, repo, issue, pr) {
  return { item, repo, issue, state: 'CLOSED', state_reason: 'COMPLETED', pr, pr_repository: repo, pr_merged: true, pr_issue_ref: issue, merged_before_close: true, merge_commit: 'abcdef12' };
}
function goodEvidence() {
  const items = [entry('page:alpha-page', 'gntik-ai/falcone', 101, 201), entry('gap:beta-gap', 'gntik-ai/gntik-ui', 30, 86)];
  return { blocked_by: items.map((item) => item.item), items };
}

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cutover-gate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runGate(t, evidence, { rollback = goodRollback, args = [], env = {} } = {}) {
  const directory = scratch(t);
  const evidencePath = join(directory, 'cutover-gate.json');
  const rollbackPath = join(directory, 'web-console-rollback.json');
  writeFileSync(evidencePath, typeof evidence === 'string' ? evidence : JSON.stringify(evidence));
  writeFileSync(rollbackPath, JSON.stringify(rollback));
  const result = spawnSync(process.execPath, [gate, '--evidence', evidencePath, '--rollback', rollbackPath, ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env }
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

test('a complete evidence file passes and lists the issue numbers', (t) => {
  const result = runGate(t, goodEvidence());
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /gntik-ai\/falcone#101/);
  assert.match(result.output, /gntik-ai\/gntik-ui#30/);
});

test('the committed evidence passes: exactly the 57 Blocked-by items, 50 pages and 7 gaps', () => {
  const result = spawnSync(process.execPath, [gate, '--evidence', committedEvidence, '--rollback', committedRollback], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const evidence = JSON.parse(readFileSync(committedEvidence, 'utf8'));
  assert.equal(evidence.blocked_by.length, 57);
  assert.equal(evidence.blocked_by.filter((id) => id.startsWith('page:')).length, 50);
  assert.equal(evidence.blocked_by.filter((id) => id.startsWith('gap:')).length, 7);
  assert.deepEqual(evidence.items.map((item) => item.item).sort(), [...evidence.blocked_by].sort());
});

const offlineNegatives = [
  ['a missing item', (e) => { e.items.pop(); }, /missing from the evidence: gap:beta-gap/],
  ['an item outside the Blocked-by list', (e) => { e.items.push(entry('page:extra-page', 'gntik-ai/falcone', 5, 6)); }, /page:extra-page: not in the Blocked-by list/],
  ['a duplicated item', (e) => { e.items.push({ ...e.items[0] }); }, /duplicate/],
  ['a closure with reason NOT_PLANNED', (e) => { e.items[0].state_reason = 'NOT_PLANNED'; }, /page:alpha-page.*NOT_PLANNED/],
  ['an issue that is still open', (e) => { e.items[0].state = 'OPEN'; }, /page:alpha-page.*not CLOSED/],
  ['an unmerged PR', (e) => { e.items[0].pr_merged = false; }, /page:alpha-page.*not merged/],
  ['a PR that references a different issue', (e) => { e.items[0].pr_issue_ref = 999; }, /page:alpha-page.*references issue 999/],
  ['a PR merged after the issue closed', (e) => { e.items[0].merged_before_close = false; }, /page:alpha-page.*after the issue closed/],
  ['a PR from another repository', (e) => { e.items[1].pr_repository = 'gntik-ai/falcone'; }, /gap:beta-gap.*repository/],
  ['a PR without a repository', (e) => { delete e.items[0].pr_repository; }, /page:alpha-page.*repository/],
  ['an entry without a repository', (e) => { delete e.items[0].repo; }, /page:alpha-page.*repo/],
  ['a repository outside the allow-list', (e) => { e.items[0].repo = 'someone/else'; e.items[0].pr_repository = 'someone/else'; }, /page:alpha-page.*allow-list/],
  ['a missing merge commit', (e) => { delete e.items[0].merge_commit; }, /page:alpha-page.*merge commit/],
];
for (const [name, mutate, symptom] of offlineNegatives) {
  test(`the gate fails for ${name}`, (t) => {
    const evidence = goodEvidence();
    mutate(evidence);
    const result = runGate(t, evidence);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, symptom);
  });
}

test('the gate fails closed on unreadable or malformed evidence', (t) => {
  for (const body of ['', '{', 'null', '{"blocked_by": [], "items": []}', '{"blocked_by": "x", "items": []}']) {
    const result = runGate(t, body);
    assert.equal(result.status, 1, `${body}: ${result.output}`);
  }
});

test('the rollback evidence must record the prior tag and a sha256 digest', (t) => {
  for (const rollback of [
    {},
    { ...goodRollback, prior: { ...goodRollback.prior, tag: '' } },
    { ...goodRollback, prior: { ...goodRollback.prior, digest: 'sha256:abc' } },
    { ...goodRollback, prior: { ...goodRollback.prior, digest: `sha1:${'a'.repeat(64)}` } },
    { ...goodRollback, prior: { ...goodRollback.prior, verified_on: 'yesterday' } },
    { ...goodRollback, prior: { ...goodRollback.prior, source: '' } },
    { ...goodRollback, switch_release: { digest: 'not-a-digest' } },
  ]) {
    const result = runGate(t, goodEvidence(), { rollback });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /rollback/i);
  }
});

test('the committed rollback evidence records the prior release by tag and digest', () => {
  const rollback = JSON.parse(readFileSync(committedRollback, 'utf8'));
  assert.equal(rollback.prior.tag, 'sha-ca5183d');
  assert.equal(rollback.prior.digest, 'sha256:77e614f1a084b2ada754bccfab37c6018ffed5302078e87c89c055dd8c80dd5a');
  assert.match(rollback.prior.verified_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(rollback.switch_release.digest, null, 'the switch-release digest is recorded by the operator after publication');
});

// --- API re-check, against a local stub of the GitHub REST API (no network) ---

function apiFixtures() {
  const day = (n) => `2026-11-${String(n).padStart(2, '0')}T10:00:00Z`;
  const issue = (number) => ({ number, state: 'closed', state_reason: 'completed', closed_at: day(15) });
  const pull = (repo, number, issueNumber) => ({
    number, merged: true, merged_at: day(10), merge_commit_sha: 'abcdef1234567890', title: `Implement #${issueNumber}`, body: '', head: { ref: 'feature' },
    html_url: `https://github.com/${repo}/pull/${number}`
  });
  return {
    '/repos/gntik-ai/falcone/issues/101': issue(101), '/repos/gntik-ai/falcone/pulls/201': pull('gntik-ai/falcone', 201, 101),
    '/repos/gntik-ai/gntik-ui/issues/30': issue(30), '/repos/gntik-ai/gntik-ui/pulls/86': pull('gntik-ai/gntik-ui', 86, 30)
  };
}

async function withApi(t, fixtures, evidence, extraEnv = {}) {
  const requested = [];
  const server = http.createServer((req, res) => {
    requested.push(req.url);
    const body = fixtures[req.url];
    if (body === 'error') { res.writeHead(500); return res.end('boom'); }
    if (body === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>'); }
    if (!body) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const directory = scratch(t);
  const evidencePath = join(directory, 'cutover-gate.json');
  const rollbackPath = join(directory, 'web-console-rollback.json');
  writeFileSync(evidencePath, JSON.stringify(evidence));
  writeFileSync(rollbackPath, JSON.stringify(goodRollback));
  const child = spawn(process.execPath, [gate, '--evidence', evidencePath, '--rollback', rollbackPath, '--api'], {
    env: { PATH: process.env.PATH, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_TOKEN: 'fixture-token', ...extraEnv }
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const [status] = await once(child, 'close');
  return { status, output, requested };
}

test('the API re-check passes without relying on the closing-PR association', async (t) => {
  const result = await withApi(t, apiFixtures(), goodEvidence());
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.requested.filter((url) => !/^\/repos\/[^/]+\/[^/]+\/(?:issues|pulls)\/\d+$/.test(url)), [], 'only the issue and the PR are read');
});

test('a PR passes when its title, body, head branch or issue URL references the issue', async (t) => {
  for (const patch of [
    { title: 'chore', body: 'Closes #101' },
    { title: 'chore (#101)', body: '' },
    { title: 'chore', body: 'See https://github.com/gntik-ai/falcone/issues/101' },
    { title: 'chore', body: '', head: { ref: 'agent/issue-101-switch' } },
    { title: 'chore', body: '', head: { ref: 'agent/falcone/101/0f0f' } },
  ]) {
    const fixtures = apiFixtures();
    Object.assign(fixtures['/repos/gntik-ai/falcone/pulls/201'], patch);
    const result = await withApi(t, fixtures, goodEvidence());
    assert.equal(result.status, 0, `${JSON.stringify(patch)}: ${result.output}`);
  }
});

const apiNegatives = [
  ['a not_planned closure', (f) => { f['/repos/gntik-ai/falcone/issues/101'].state_reason = 'not_planned'; }, /page:alpha-page.*not_planned/],
  ['a closure without a reason', (f) => { delete f['/repos/gntik-ai/falcone/issues/101'].state_reason; }, /page:alpha-page.*state reason/],
  ['an open issue', (f) => { f['/repos/gntik-ai/falcone/issues/101'].state = 'open'; }, /page:alpha-page.*not closed/],
  ['an unmerged PR', (f) => { f['/repos/gntik-ai/falcone/pulls/201'].merged = false; f['/repos/gntik-ai/falcone/pulls/201'].merged_at = null; }, /page:alpha-page.*not merged/],
  ['a PR that references a different issue', (f) => { Object.assign(f['/repos/gntik-ai/falcone/pulls/201'], { title: 'chore #102', body: 'Fixes #1010 and #10', head: { ref: 'feature' } }); }, /page:alpha-page.*does not reference issue 101/],
  ['a PR merged after the issue closed', (f) => { f['/repos/gntik-ai/falcone/pulls/201'].merged_at = '2026-11-16T10:00:00Z'; }, /page:alpha-page.*merged after/],
  ['the same PR number in another repository', (f) => { f['/repos/gntik-ai/gntik-ui/pulls/86'].html_url = 'https://github.com/gntik-ai/falcone/pull/86'; }, /gap:beta-gap.*repository/],
  ['a PR without an identity', (f) => { delete f['/repos/gntik-ai/falcone/pulls/201'].html_url; }, /page:alpha-page.*identity/],
  ['a PR with another number', (f) => { f['/repos/gntik-ai/falcone/pulls/201'].html_url = 'https://github.com/gntik-ai/falcone/pull/202'; }, /page:alpha-page.*identity|number/],
  ['a different merge commit', (f) => { f['/repos/gntik-ai/falcone/pulls/201'].merge_commit_sha = '1111111111111111'; }, /page:alpha-page.*merge commit/],
  ['an API error', (f) => { f['/repos/gntik-ai/falcone/issues/101'] = 'error'; }, /page:alpha-page.*API/],
  ['a non-JSON API answer', (f) => { f['/repos/gntik-ai/falcone/pulls/201'] = 'html'; }, /page:alpha-page.*API/],
  ['a missing API object', (f) => { delete f['/repos/gntik-ai/gntik-ui/pulls/86']; }, /gap:beta-gap.*API/],
];
for (const [name, mutate, symptom] of apiNegatives) {
  test(`the API re-check fails closed for ${name}`, async (t) => {
    const fixtures = apiFixtures();
    mutate(fixtures);
    const result = await withApi(t, fixtures, goodEvidence());
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, symptom);
  });
}

test('the API re-check fails closed without a token', async (t) => {
  const result = await withApi(t, apiFixtures(), goodEvidence(), { GITHUB_TOKEN: '' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /GITHUB_TOKEN/);
});
