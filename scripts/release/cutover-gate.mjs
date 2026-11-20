#!/usr/bin/env node
// Fail-closed release gate for the web-console cutover (UI migration blueprint 57f536f4, item cutover:u5-cutover).
//
// The gate reads release-evidence/cutover-gate.json, which records, for every blocking page:* and gap:* item, the
// change-request issue, the pull request that delivered it and what was observed on GitHub. It passes only when
//   - every item of the blocking list has exactly one entry, and no entry is outside the list;
//   - each issue is CLOSED with state reason COMPLETED (NOT_PLANNED fails);
//   - the recorded pull request is merged, lives in the recorded repository, and references that exact issue
//     (#N, the issue URL, or issue-N / agent/<project>/N/ in the head branch);
//   - the pull request was merged no later than the issue was closed.
// GitHub's closing-PR association is deliberately not required: Hermes closes these issues after staging
// verification, not through a "Closes #N" merge.
//
// Offline (always): the recorded observations above are validated. Online (when GITHUB_TOKEN is set, i.e. in CI): every
// entry is re-checked against the GitHub API, and any mismatch, missing repository identity or API error fails.
// The gate also requires a well-formed release-evidence/web-console-rollback.json (prior tag and digest).
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const ALLOWED_REPOSITORIES = ['gntik-ai/falcone', 'gntik-ai/gntik-ui'];
export const DEFAULT_EVIDENCE = 'release-evidence/cutover-gate.json';
export const DEFAULT_ROLLBACK = 'release-evidence/web-console-rollback.json';
const API_BASE = 'https://api.github.com';
const ITEM_PATTERN = /^(?:page|gap):[A-Za-z0-9][A-Za-z0-9._-]*$/;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

// True when the pull request's title, body or head branch references exactly this issue of this repository.
export function referencesIssue({ title = '', body = '', headRef = '' }, repository, issue) {
  const number = String(issue);
  const repo = escapeRegex(repository);
  const text = `${title}\n${body}`;
  const forms = [
    new RegExp(`(?<![\\w/&])#${number}(?!\\d)`),
    new RegExp(`(?<![\\w/-])${repo}#${number}(?!\\d)`, 'i'),
    new RegExp(`https://github\\.com/${repo}/issues/${number}(?!\\d)`, 'i')
  ];
  if (forms.some((form) => form.test(text))) return true;
  return new RegExp(`(?<![\\w-])issue-${number}(?!\\d)`).test(headRef) || new RegExp(`^agent/[^/]+/${number}/`).test(headRef);
}

// Shape of the evidence file itself: the blocking list and its entries must agree one to one.
export function checkEvidenceShape(evidence) {
  const problems = [];
  if (!evidence || typeof evidence !== 'object') return ['the evidence file is not a JSON object'];
  const { blockedBy, entries } = evidence;
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) problems.push('blockedBy must list the blocking items');
  if (!Array.isArray(entries) || entries.length === 0) problems.push('entries must list the recorded closures');
  if (problems.length) return problems;
  const required = new Set();
  for (const blocking of blockedBy) {
    if (!blocking || typeof blocking.item !== 'string' || !ITEM_PATTERN.test(blocking.item)) problems.push(`blockedBy has an invalid item: ${JSON.stringify(blocking)}`);
    else if (required.has(blocking.item)) problems.push(`blockedBy lists ${blocking.item} twice`);
    else required.add(blocking.item);
  }
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry?.item)) problems.push(`${entry.item}: more than one entry`);
    seen.add(entry?.item);
    if (!required.has(entry?.item)) problems.push(`${entry?.item}: entry is not in the blocking list`);
  }
  for (const item of required) if (!seen.has(item)) problems.push(`${item}: blocking item has no entry`);
  return problems;
}

// What the evidence file recorded for one entry, judged on its own.
export function judgeRecordedEntry(entry) {
  const label = `${entry?.item ?? '(no item)'}`;
  const problems = [];
  if (!ALLOWED_REPOSITORIES.includes(entry?.repo)) problems.push(`${label}: repository ${JSON.stringify(entry?.repo)} is not a known repository`);
  if (!isPositiveInteger(entry?.issue)) problems.push(`${label}: issue number is missing`);
  if (!isPositiveInteger(entry?.pr)) problems.push(`${label}: pull request number is missing`);
  if (!/^[0-9a-f]{7,40}$/.test(entry?.mergeCommit ?? '')) problems.push(`${label}: merge commit is missing`);
  if (entry?.state !== 'CLOSED') problems.push(`${label}: issue #${entry?.issue} is not closed (state ${entry?.state ?? 'unknown'})`);
  else if (entry?.stateReason !== 'COMPLETED') problems.push(`${label}: issue #${entry?.issue} was closed as ${entry?.stateReason ?? 'unknown'}, not COMPLETED`);
  if (entry?.prRepository === undefined || entry?.prRepository === null || entry?.prRepository === '') problems.push(`${label}: pull request repository identity is missing`);
  else if (entry.prRepository !== entry.repo) problems.push(`${label}: pull request #${entry.pr} belongs to ${entry.prRepository}, not ${entry.repo}`);
  if (entry?.prMerged !== true) problems.push(`${label}: pull request #${entry?.pr} is not merged`);
  if (entry?.prReferencesIssue !== true) problems.push(`${label}: pull request #${entry?.pr} does not reference issue #${entry?.issue}`);
  if (entry?.mergedBeforeClosed !== true) problems.push(`${label}: pull request #${entry?.pr} was merged after issue #${entry?.issue} was closed`);
  return problems;
}

// One entry judged against what GitHub reports now (issue and pull request payloads of the REST API).
export function judgeObservedEntry(entry, { issue, pull }) {
  const label = entry.item;
  const problems = [];
  if (issue.pull_request) problems.push(`${label}: #${entry.issue} is a pull request, not an issue`);
  if (issue.state !== 'closed') problems.push(`${label}: issue #${entry.issue} is ${issue.state ?? 'in an unknown state'}, not closed`);
  else if (issue.state_reason !== 'completed') problems.push(`${label}: issue #${entry.issue} was closed as ${issue.state_reason ?? 'unknown'}, not completed`);
  const identities = [];
  const fromUrl = typeof pull.html_url === 'string' ? pull.html_url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/) : null;
  if (typeof pull.html_url === 'string' && !fromUrl) problems.push(`${label}: pull request URL ${pull.html_url} is not a GitHub pull request URL`);
  if (fromUrl) {
    identities.push(fromUrl[1]);
    if (Number(fromUrl[2]) !== entry.pr) problems.push(`${label}: pull request URL names #${fromUrl[2]}, not #${entry.pr}`);
  }
  for (const name of [pull.base?.repo?.full_name, pull.repository?.full_name]) if (typeof name === 'string' && name) identities.push(name);
  // The repository comes only from the API payload; a payload without one fails rather than assuming the recorded one.
  if (identities.length === 0) problems.push(`${label}: pull request #${entry.pr} reports no repository identity`);
  for (const identity of identities) {
    if (identity.toLowerCase() !== entry.repo.toLowerCase()) problems.push(`${label}: pull request #${entry.pr} belongs to ${identity}, not ${entry.repo}`);
  }
  if (pull.number !== undefined && pull.number !== entry.pr) problems.push(`${label}: pull request payload is #${pull.number}, not #${entry.pr}`);
  if (pull.merged !== true || !pull.merged_at) problems.push(`${label}: pull request #${entry.pr} is not merged`);
  if (!referencesIssue({ title: pull.title ?? '', body: pull.body ?? '', headRef: pull.head?.ref ?? '' }, entry.repo, entry.issue)) {
    problems.push(`${label}: pull request #${entry.pr} does not reference issue #${entry.issue}`);
  }
  const mergedAt = Date.parse(pull.merged_at ?? '');
  const closedAt = Date.parse(issue.closed_at ?? '');
  if (Number.isNaN(mergedAt) || Number.isNaN(closedAt)) problems.push(`${label}: merge or close time is missing`);
  else if (mergedAt > closedAt) problems.push(`${label}: pull request #${entry.pr} was merged after issue #${entry.issue} was closed`);
  if (typeof pull.merge_commit_sha !== 'string' || !pull.merge_commit_sha.startsWith(entry.mergeCommit)) {
    problems.push(`${label}: merge commit ${pull.merge_commit_sha ?? '(none)'} does not match the recorded ${entry.mergeCommit}`);
  }
  return problems;
}

async function getJson(fetchImpl, token, path) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'falcone-cutover-gate'
    }
  });
  if (!response?.ok) throw new Error(`GitHub API ${path} answered ${response?.status ?? 'no response'}`);
  return response.json();
}

export async function recheckEntryOnline(entry, { fetchImpl, token }) {
  try {
    const [issue, pull] = await Promise.all([
      getJson(fetchImpl, token, `/repos/${entry.repo}/issues/${entry.issue}`),
      getJson(fetchImpl, token, `/repos/${entry.repo}/pulls/${entry.pr}`)
    ]);
    return judgeObservedEntry(entry, { issue, pull });
  } catch (error) {
    return [`${entry.item}: GitHub re-check failed: ${error.message}`];
  }
}

export function checkRollbackEvidence(rollback) {
  const problems = [];
  const prior = rollback?.prior;
  if (!prior || typeof prior !== 'object') return ['the rollback evidence has no prior release'];
  if (!/^sha-[0-9a-f]{7,40}$/.test(prior.tag ?? '')) problems.push('rollback evidence: prior.tag is missing or not a sha-* tag');
  if (!/^sha256:[0-9a-f]{64}$/.test(prior.digest ?? '')) problems.push('rollback evidence: prior.digest is missing or not an immutable sha256 digest');
  if (rollback.image !== 'ghcr.io/gntik-ai/in-falcone-web-console') problems.push('rollback evidence: image must be ghcr.io/gntik-ai/in-falcone-web-console');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rollback.verifiedAt ?? '')) problems.push('rollback evidence: verifiedAt is missing');
  if (typeof rollback.source !== 'string' || !rollback.source) problems.push('rollback evidence: source is missing');
  return problems;
}

export async function runGate({ evidence, rollback, online = false, fetchImpl, token }) {
  const problems = [...checkEvidenceShape(evidence)];
  // Judge every entry even when the shape is wrong, so one run reports every problem.
  const entries = Array.isArray(evidence?.entries) ? evidence.entries : [];
  for (const entry of entries) problems.push(...judgeRecordedEntry(entry));
  if (online && problems.length === 0) {
    if (!token || typeof fetchImpl !== 'function') problems.push('online re-check requested without a GitHub token');
    else {
      const results = await Promise.all(entries.map((entry) => recheckEntryOnline(entry, { fetchImpl, token })));
      for (const result of results) problems.push(...result);
    }
  } else if (online && (!token || typeof fetchImpl !== 'function')) problems.push('online re-check requested without a GitHub token');
  problems.push(...checkRollbackEvidence(rollback));
  const issues = entries.map((entry) => `${entry.repo}#${entry.issue}`);
  return { ok: problems.length === 0, problems, issues, online };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch) {
  const option = (name, fallback) => {
    const index = argv.indexOf(name);
    return index === -1 ? fallback : argv[index + 1];
  };
  const evidencePath = option('--evidence', DEFAULT_EVIDENCE);
  const rollbackPath = option('--rollback', DEFAULT_ROLLBACK);
  const token = env.GITHUB_TOKEN || undefined;
  const offline = argv.includes('--offline');
  // CI must never silently skip the API re-check: a missing token there is a failure, not a downgrade.
  const online = !offline && (Boolean(token) || env.GITHUB_ACTIONS === 'true' || argv.includes('--online'));
  let evidence;
  let rollback;
  try {
    evidence = await readJson(evidencePath);
  } catch (error) {
    console.error(`cutover gate FAILED: cannot read ${evidencePath}: ${error.message}`);
    return 1;
  }
  try {
    rollback = await readJson(rollbackPath);
  } catch (error) {
    console.error(`cutover gate FAILED: cannot read ${rollbackPath}: ${error.message}`);
    return 1;
  }
  const result = await runGate({ evidence, rollback, online, fetchImpl, token });
  if (!result.ok) {
    console.error(`cutover gate FAILED (${result.problems.length} problem${result.problems.length === 1 ? '' : 's'}):`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    return 1;
  }
  const mode = result.online ? 'recorded evidence and GitHub API re-check' : 'recorded evidence only (no GITHUB_TOKEN)';
  const lines = [`cutover gate PASSED: ${result.issues.length} blocking issues closed by merged pull requests (${mode}).`, `Issues: ${result.issues.join(', ')}`];
  for (const line of lines) console.log(line);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### Cutover gate\n\n${lines.join('\n\n')}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
