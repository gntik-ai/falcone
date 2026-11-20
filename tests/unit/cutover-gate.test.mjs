import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { main, referencesIssue, runGate } from '../../scripts/release/cutover-gate.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const committedEvidence = () => JSON.parse(readFileSync(join(repoRoot, 'release-evidence/cutover-gate.json'), 'utf8'));
const committedRollback = () => JSON.parse(readFileSync(join(repoRoot, 'release-evidence/web-console-rollback.json'), 'utf8'));

// A small, complete fixture. No test here reaches the network: the GitHub API is a fake fetch.
function fixtureEntry(item, repo, issue, pr, mergeCommit) {
  return { item, repo, issue, pr, mergeCommit, state: 'CLOSED', stateReason: 'COMPLETED', prRepository: repo, prMerged: true, prReferencesIssue: true, mergedBeforeClosed: true };
}
const fixture = () => ({
  schema: 'falcone.cutover-gate/v1',
  blockedBy: [{ item: 'page:alpha-page' }, { item: 'page:beta-page' }, { item: 'gap:gamma-gap' }],
  entries: [
    fixtureEntry('page:alpha-page', 'gntik-ai/falcone', 101, 201, 'aaaaaaa1'),
    fixtureEntry('page:beta-page', 'gntik-ai/falcone', 102, 202, 'bbbbbbb2'),
    fixtureEntry('gap:gamma-gap', 'gntik-ai/gntik-ui', 30, 86, 'ccccccc3')
  ]
});
const rollback = () => ({
  image: 'ghcr.io/gntik-ai/in-falcone-web-console',
  prior: { tag: 'sha-ca5183d', digest: `sha256:${'a'.repeat(64)}` },
  source: 'fixture',
  verifiedAt: '2026-11-19'
});
const problemsOf = async (evidence, extra = {}) => (await runGate({ evidence, rollback: rollback(), ...extra })).problems.join('\n');

function apiFor(entries, override = () => ({})) {
  const payloads = new Map();
  for (const entry of entries) {
    payloads.set(`/repos/${entry.repo}/issues/${entry.issue}`, {
      state: 'closed', state_reason: 'completed', closed_at: '2026-11-18T12:00:00Z', ...override(entry, 'issue')
    });
    payloads.set(`/repos/${entry.repo}/pulls/${entry.pr}`, {
      number: entry.pr, merged: true, merged_at: '2026-11-17T12:00:00Z', html_url: `https://github.com/${entry.repo}/pull/${entry.pr}`,
      base: { repo: { full_name: entry.repo } }, title: `feat: page (#${entry.issue})`, body: '', head: { ref: 'agent/x' },
      merge_commit_sha: `${entry.mergeCommit}0123456789`, ...override(entry, 'pull')
    });
  }
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace('https://api.github.com', '');
    calls.push({ path, authorization: init.headers.authorization });
    const payload = payloads.get(path);
    if (!payload) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetchImpl, calls };
}
const online = (evidence, override) => runGate({ evidence, rollback: rollback(), online: true, token: 'fixture-token', ...apiFor(evidence.entries, override) });

test('the committed evidence covers the 57 blocking items and passes offline', async () => {
  const evidence = committedEvidence();
  assert.equal(evidence.blockedBy.length, 57);
  assert.equal(evidence.blockedBy.filter(({ item }) => item.startsWith('page:')).length, 50);
  assert.equal(evidence.blockedBy.filter(({ item }) => item.startsWith('gap:')).length, 7);
  assert.equal(evidence.sourceEvidenceSha256, 'ac4ff6f5d29069056f998286be696ddabdef57189fbefda216d06ca4cbd4dd23');
  const result = await runGate({ evidence, rollback: committedRollback() });
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 57);
  assert.ok(result.issues.includes('gntik-ai/falcone#1302'));
  assert.ok(result.issues.includes('gntik-ai/gntik-ui#30'));
  assert.ok(result.issues.includes('gntik-ai/gntik-ui#13'));
});

test('a complete fixture passes and lists its issue numbers', async () => {
  const result = await runGate({ evidence: fixture(), rollback: rollback() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, ['gntik-ai/falcone#101', 'gntik-ai/falcone#102', 'gntik-ai/gntik-ui#30']);
});

test('the gate fails on a blocking item without an entry', async () => {
  const evidence = fixture();
  evidence.entries.splice(1, 1);
  assert.match(await problemsOf(evidence), /page:beta-page: blocking item has no entry/);
});

test('the gate fails on an entry outside the blocking list and on a duplicate entry', async () => {
  const outside = fixture();
  outside.entries.push(fixtureEntry('page:extra-page', 'gntik-ai/falcone', 5, 6, 'ddddddd4'));
  assert.match(await problemsOf(outside), /page:extra-page: entry is not in the blocking list/);
  const duplicate = fixture();
  duplicate.entries.push({ ...duplicate.entries[0] });
  assert.match(await problemsOf(duplicate), /page:alpha-page: more than one entry/);
});

test('the gate fails on an open issue', async () => {
  const evidence = fixture();
  Object.assign(evidence.entries[0], { state: 'OPEN', stateReason: null });
  assert.match(await problemsOf(evidence), /page:alpha-page: issue #101 is not closed/);
});

test('the gate fails on a not_planned closure', async () => {
  const evidence = fixture();
  evidence.entries[1].stateReason = 'NOT_PLANNED';
  assert.match(await problemsOf(evidence), /page:beta-page: issue #102 was closed as NOT_PLANNED, not COMPLETED/);
});

test('the gate fails on an unmerged pull request', async () => {
  const evidence = fixture();
  evidence.entries[0].prMerged = false;
  assert.match(await problemsOf(evidence), /page:alpha-page: pull request #201 is not merged/);
});

test('the gate fails on a pull request that references another issue', async () => {
  const evidence = fixture();
  evidence.entries[2].prReferencesIssue = false;
  assert.match(await problemsOf(evidence), /gap:gamma-gap: pull request #86 does not reference issue #30/);
});

test('the gate fails on a pull request merged after the issue was closed', async () => {
  const evidence = fixture();
  evidence.entries[0].mergedBeforeClosed = false;
  assert.match(await problemsOf(evidence), /page:alpha-page: pull request #201 was merged after issue #101 was closed/);
});

test('the gate fails on a pull request recorded in another repository, or without a recorded repository', async () => {
  const other = fixture();
  other.entries[0].prRepository = 'gntik-ai/gntik-ui';
  assert.match(await problemsOf(other), /page:alpha-page: pull request #201 belongs to gntik-ai\/gntik-ui, not gntik-ai\/falcone/);
  const missing = fixture();
  delete missing.entries[0].prRepository;
  assert.match(await problemsOf(missing), /page:alpha-page: pull request repository identity is missing/);
});

test('the gate fails on malformed entries', async () => {
  const evidence = fixture();
  Object.assign(evidence.entries[0], { repo: 'someone/else', issue: 0, pr: 'x', mergeCommit: 'xyz' });
  const problems = await problemsOf(evidence);
  assert.match(problems, /not a known repository/);
  assert.match(problems, /issue number is missing/);
  assert.match(problems, /pull request number is missing/);
  assert.match(problems, /merge commit is missing/);
});

test('the online re-check passes when GitHub agrees with the evidence, sending the token only as a bearer header', async () => {
  const evidence = fixture();
  const api = apiFor(evidence.entries);
  const result = await runGate({ evidence, rollback: rollback(), online: true, token: 'fixture-token', ...api });
  assert.deepEqual(result.problems, []);
  assert.equal(api.calls.length, 6);
  assert.ok(api.calls.every((call) => call.authorization === 'Bearer fixture-token'));
  assert.ok(api.calls.some((call) => call.path === '/repos/gntik-ai/gntik-ui/pulls/86'));
});

test('the online re-check fails closed on an open issue, a not_planned closure and an unmerged pull request', async () => {
  const open = await online(fixture(), (entry, kind) => (kind === 'issue' && entry.issue === 101 ? { state: 'open', state_reason: null, closed_at: null } : {}));
  assert.match(open.problems.join('\n'), /page:alpha-page: issue #101 is open, not closed/);
  const notPlanned = await online(fixture(), (entry, kind) => (kind === 'issue' && entry.issue === 102 ? { state_reason: 'not_planned' } : {}));
  assert.match(notPlanned.problems.join('\n'), /page:beta-page: issue #102 was closed as not_planned, not completed/);
  const unmerged = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 201 ? { merged: false, merged_at: null } : {}));
  assert.match(unmerged.problems.join('\n'), /page:alpha-page: pull request #201 is not merged/);
});

test('the online re-check does not require GitHub\'s closing pull request association', async () => {
  const result = await online(fixture(), (entry, kind) => (kind === 'issue' ? { closed_by: null, closer: null, timeline_url: undefined } : {}));
  assert.deepEqual(result.problems, []);
});

test('the online re-check fails on a pull request that references another issue, in title, body and branch', async () => {
  const other = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 202 ? { title: 'feat: something (#999)', body: 'Refs #1020', head: { ref: 'agent/falcone/999/abc' } } : {}));
  assert.match(other.problems.join('\n'), /page:beta-page: pull request #202 does not reference issue #102/);
  assert.doesNotMatch(other.problems.join('\n'), /page:alpha-page/);
});

test('the online re-check fails on a pull request merged after the issue was closed', async () => {
  const late = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 201 ? { merged_at: '2026-11-19T00:00:00Z' } : {}));
  assert.match(late.problems.join('\n'), /page:alpha-page: pull request #201 was merged after issue #101 was closed/);
  const same = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 201 ? { merged_at: '2026-11-18T12:00:00Z' } : {}));
  assert.deepEqual(same.problems, [], 'merged exactly at the close time is allowed');
});

test('the online re-check fails on the same pull request number in another repository', async () => {
  const swapped = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 201
    ? { html_url: 'https://github.com/gntik-ai/gntik-ui/pull/201', base: { repo: { full_name: 'gntik-ai/gntik-ui' } } } : {}));
  assert.match(swapped.problems.join('\n'), /page:alpha-page: pull request #201 belongs to gntik-ai\/gntik-ui, not gntik-ai\/falcone/);
  const slug = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 86 ? { html_url: undefined, base: { repo: { full_name: 'gntik-ai/falcone' } } } : {}));
  assert.match(slug.problems.join('\n'), /gap:gamma-gap: pull request #86 belongs to gntik-ai\/falcone, not gntik-ai\/gntik-ui/);
});

test('the online re-check fails when the pull request reports no repository identity, never assuming the recorded one', async () => {
  const none = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 201 ? { html_url: undefined, base: undefined, repository: undefined } : {}));
  assert.match(none.problems.join('\n'), /page:alpha-page: pull request #201 reports no repository identity/);
});

test('the online re-check fails on a merge commit that does not match the evidence', async () => {
  const wrong = await online(fixture(), (entry, kind) => (kind === 'pull' && entry.pr === 202 ? { merge_commit_sha: 'f'.repeat(40) } : {}));
  assert.match(wrong.problems.join('\n'), /page:beta-page: merge commit f{40} does not match the recorded bbbbbbb2/);
});

test('the online re-check fails closed on an API error, a rejected request and a missing token', async () => {
  const evidence = fixture();
  const notFound = await runGate({ evidence, rollback: rollback(), online: true, token: 'fixture-token', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.match(notFound.problems.join('\n'), /page:alpha-page: GitHub re-check failed: GitHub API \/repos\/gntik-ai\/falcone\/issues\/101 answered 500/);
  const rejected = await runGate({ evidence, rollback: rollback(), online: true, token: 'fixture-token', fetchImpl: async () => { throw new Error('network down'); } });
  assert.match(rejected.problems.join('\n'), /GitHub re-check failed: network down/);
  const tokenless = await runGate({ evidence, rollback: rollback(), online: true, ...apiFor(evidence.entries) });
  assert.match(tokenless.problems.join('\n'), /online re-check requested without a GitHub token/);
});

test('referencesIssue accepts #N, the issue URL and issue-N or agent branches, and nothing else', () => {
  const repo = 'gntik-ai/falcone';
  assert.equal(referencesIssue({ title: 'fix: x (#1304)' }, repo, 1304), true);
  assert.equal(referencesIssue({ body: 'Refs\n#1304.' }, repo, 1304), true);
  assert.equal(referencesIssue({ body: 'See https://github.com/gntik-ai/falcone/issues/1304' }, repo, 1304), true);
  assert.equal(referencesIssue({ body: 'gntik-ai/falcone#1304' }, repo, 1304), true);
  assert.equal(referencesIssue({ headRef: 'fix/issue-1304-redirect' }, repo, 1304), true);
  assert.equal(referencesIssue({ headRef: 'agent/falcone/1304/8c216928' }, repo, 1304), true);
  assert.equal(referencesIssue({ title: '#13040' }, repo, 1304), false);
  assert.equal(referencesIssue({ title: '#130' }, repo, 1304), false);
  assert.equal(referencesIssue({ headRef: 'agent/falcone/13040/abc' }, repo, 1304), false);
  assert.equal(referencesIssue({ headRef: 'fix/issue-13040' }, repo, 1304), false);
  assert.equal(referencesIssue({ body: 'gntik-ai/gntik-ui#1304' }, repo, 1304), false, 'an issue of another repository is not this issue');
  assert.equal(referencesIssue({ body: 'https://github.com/gntik-ai/gntik-ui/issues/1304' }, repo, 1304), false);
  assert.equal(referencesIssue({ title: 'chore', body: 'nothing', headRef: 'main' }, repo, 1304), false);
});

test('the rollback evidence records the prior tag and digest exactly and the gate requires it', async () => {
  const recorded = committedRollback();
  assert.equal(recorded.prior.tag, 'sha-ca5183d');
  assert.equal(recorded.prior.digest, 'sha256:77e614f1a084b2ada754bccfab37c6018ffed5302078e87c89c055dd8c80dd5a');
  assert.equal(recorded.prior.reference, 'ghcr.io/gntik-ai/in-falcone-web-console@sha256:77e614f1a084b2ada754bccfab37c6018ffed5302078e87c89c055dd8c80dd5a');
  assert.equal(recorded.verifiedAt, '2026-11-19');
  assert.equal(recorded.chartKey, 'webConsole');
  const evidence = fixture();
  for (const [mutate, pattern] of [
    [(value) => { value.prior.digest = 'sha256:abc'; }, /prior\.digest is missing or not an immutable sha256 digest/],
    [(value) => { value.prior.tag = 'latest'; }, /prior\.tag is missing or not a sha-\* tag/],
    [(value) => { delete value.prior; }, /no prior release/],
    [(value) => { delete value.verifiedAt; }, /verifiedAt is missing/]
  ]) {
    const broken = rollback();
    mutate(broken);
    assert.match((await runGate({ evidence, rollback: broken })).problems.join('\n'), pattern);
  }
});

function cli(args, env = {}) {
  const result = spawnSync(process.execPath, ['scripts/release/cutover-gate.mjs', ...args], {
    cwd: repoRoot, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('the CLI passes on the committed evidence offline and lists the issue numbers', () => {
  const result = cli(['--offline']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /cutover gate PASSED: 57 blocking issues/);
  assert.match(result.output, /gntik-ai\/falcone#1259/);
});

test('the CLI fails in CI without a GitHub token instead of skipping the API re-check', () => {
  const result = cli([], { GITHUB_ACTIONS: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.output, /online re-check requested without a GitHub token/);
});

test('the CLI fails closed on a missing or invalid evidence file and prints every problem', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cutover-gate-'));
  try {
    const missing = cli(['--offline', '--evidence', join(directory, 'absent.json')]);
    assert.equal(missing.status, 1);
    assert.match(missing.output, /cannot read/);
    const broken = fixture();
    broken.entries.splice(0, 1);
    broken.entries[0].state = 'OPEN';
    const evidencePath = join(directory, 'evidence.json');
    const rollbackPath = join(directory, 'rollback.json');
    writeFileSync(evidencePath, JSON.stringify(broken));
    writeFileSync(rollbackPath, JSON.stringify(rollback()));
    const result = cli(['--offline', '--evidence', evidencePath, '--rollback', rollbackPath]);
    assert.equal(result.status, 1);
    assert.match(result.output, /page:alpha-page: blocking item has no entry/);
    assert.match(result.output, /not closed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('main re-checks every committed entry through an injected API with a token and fails on a mismatch', async () => {
  const evidence = committedEvidence();
  const api = apiFor(evidence.entries);
  const directory = mkdtempSync(join(tmpdir(), 'cutover-gate-'));
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(await main([], { GITHUB_TOKEN: 'fixture-token' }, api.fetchImpl), 0);
    assert.equal(api.calls.length, 114);
    const broken = apiFor(evidence.entries, (entry, kind) => (kind === 'issue' && entry.issue === 1302 ? { state_reason: 'not_planned' } : {}));
    assert.equal(await main([], { GITHUB_TOKEN: 'fixture-token' }, broken.fetchImpl), 1);
  } finally {
    console.log = log;
    console.error = error;
    rmSync(directory, { recursive: true, force: true });
  }
});
