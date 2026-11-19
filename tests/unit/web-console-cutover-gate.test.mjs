import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/release/cutover-gate.mjs');
const evidencePath = resolve('release-evidence/cutover-gate.json');
function run(file, extra = []) {
  // Offline tests must never inherit the CI token or perform network requests.
  const env = { ...process.env, CI: '', GITHUB_TOKEN: '' };
  const dir = mkdtempSync(join(tmpdir(), 'gate-cli-'));
  const out = join(dir, 'stdout'), err = join(dir, 'stderr');
  const stdout = openSync(out, 'w'), stderr = openSync(err, 'w');
  try {
    const result = spawnSync(process.execPath, [script, '--evidence', file, ...extra], { env, stdio: ['ignore', stdout, stderr] });
    return { status: result.status, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8') };
  } finally { closeSync(stdout); closeSync(stderr); rmSync(dir, { recursive: true, force: true }); }
}
test('the complete committed cutover evidence passes at the release CLI', () => {
  const result = run(evidencePath);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /57 blocking items/);
  assert.match(result.stdout, /gntik-ai\/gntik-ui#30/);
});
for (const [name, mutate] of [
  ['missing blueprint item', (e) => e.entries.pop()],
  ['extra unknown item', (e) => e.entries.push({ ...e.entries[0], item: 'page:unknown' })],
  ['duplicate item', (e) => e.entries.push(e.entries[0])],
  ['open issue', (e) => { e.entries[0].state = 'OPEN'; }],
  ['NOT_PLANNED issue', (e) => { e.entries[0].stateReason = 'NOT_PLANNED'; }],
  ['unmerged PR', (e) => { e.entries[0].pr.merged = false; }],
  ['PR referencing another issue', (e) => { e.entries[0].pr.referencesIssue++; }],
  ['PR merged after closedAt', (e) => { e.entries[0].pr.mergedBeforeClosed = false; }],
  ['same PR number in another repository', (e) => { e.entries[0].pr.repo = 'gntik-ai/gntik-ui'; }],
  ['missing repository identity', (e) => { delete e.entries[0].pr.repo; }],
]) test(`cutover CLI rejects ${name}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutover-gate-'));
  try {
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    mutate(evidence);
    const file = join(dir, 'evidence.json'); writeFileSync(file, JSON.stringify(evidence));
    const result = run(file);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /cutover gate:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the release CLI rejects missing or malformed rollback digests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cutover-rollback-'));
  try {
    const file = join(dir, 'rollback.json');
    writeFileSync(file, JSON.stringify({ prior: { tag: 'sha-ca5183d', digest: 'sha256:unknown' } }));
    const result = run(evidencePath, ['--rollback', file]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /rollback/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [name, mutate, pass] of [
  ['valid API evidence without a closer', () => {}, true],
  ['NOT_PLANNED API closure', (i) => { i.state_reason = 'not_planned'; }, false],
  ['unmerged API PR', (_i, p) => { p.merged = false; }, false],
  ['API PR references another issue', (_i, p) => { p.body = '#9999'; }, false],
  ['API PR merged after issue close', (_i, p) => { p.merged_at = '2026-11-20T00:00:00Z'; }, false],
  ['API PR number from another repo', (_i, p) => { p.html_url = p.html_url.replace('/falcone/', '/gntik-ui/'); }, false],
  ['API missing repository identity', (_i, p) => { delete p.html_url; }, false],
  ['API error', (i) => { i.apiError = 403; }, false],
  ['API merge mismatch', (_i, p) => { p.merge_commit_sha = 'a'.repeat(40); }, false],
]) test(`offline API replay at the cutover CLI: ${name}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-api-'));
  try {
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const responses = {};
    for (const e of evidence.entries) {
      responses[`/repos/${e.repo}/issues/${e.issue}`] = { number: e.issue, state: 'closed', state_reason: 'completed', closed_at: '2026-11-19T07:00:00Z' };
      responses[`/repos/${e.repo}/pulls/${e.pr.number}`] = { number: e.pr.number, html_url: `https://github.com/${e.repo}/pull/${e.pr.number}`, merged: true, merged_at: '2026-11-18T00:00:00Z', merge_commit_sha: e.pr.mergeCommit.padEnd(40, '0'), body: `Implements #${e.issue}` };
    }
    const first = evidence.entries[0];
    mutate(responses[`/repos/${first.repo}/issues/${first.issue}`], responses[`/repos/${first.repo}/pulls/${first.pr.number}`]);
    const file = join(dir, 'api.json'); writeFileSync(file, JSON.stringify(responses));
    const result = run(evidencePath, ['--api-fixture', file]);
    assert.equal(result.status, pass ? 0 : 1, result.stdout + result.stderr);
    if (!pass) assert.match(result.stderr, /cutover gate:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
