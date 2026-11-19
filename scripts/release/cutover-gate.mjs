#!/usr/bin/env node
// Fail-closed release gate for the web-console-next cutover (blueprint 57f536f4, item cutover:u5-cutover).
//
//   node scripts/release/cutover-gate.mjs [--evidence <file>] [--rollback <file>] [--api]
//
// Offline (always): release-evidence/cutover-gate.json must record, for every item of its own `blocked_by` list
// and for no other item, an issue that is CLOSED with reason COMPLETED, closed after a MERGED pull request of the
// same repository that references that issue; and release-evidence/web-console-rollback.json must record the prior
// release by tag and digest.
//
// --api (CI, GITHUB_TOKEN required): every entry is re-checked against the GitHub REST API (GITHUB_API_URL). The
// check does not use the closing-PR association (these issues are closed by Hermes after staging verification, not
// by a "Closes #N" merge): the issue must be closed as completed, the PR must be merged, identified by the
// html_url the API returns (never defaulted to the recorded repository), reference exactly that issue in its
// title, body, head branch or issue URL, and be merged no later than the issue closed. Any API error fails the gate.
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const ALLOWED_REPOSITORIES = ['gntik-ai/falcone', 'gntik-ai/gntik-ui'];
const SHA256 = /^sha256:[0-9a-f]{64}$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

export function checkEvidence(evidence) {
  if (!isObject(evidence)) return ['evidence is not an object'];
  const { blocked_by: blockedBy, items } = evidence;
  if (!Array.isArray(blockedBy) || blockedBy.length === 0 || !blockedBy.every((id) => typeof id === 'string' && id)) {
    return ['evidence.blocked_by must list the Blocked-by items'];
  }
  if (!Array.isArray(items) || !items.every(isObject)) return ['evidence.items must be a list of entries'];
  const problems = [];
  const expected = new Set(blockedBy);
  if (expected.size !== blockedBy.length) problems.push('evidence.blocked_by contains duplicate items');
  const seen = new Set();
  for (const entry of items) {
    const id = typeof entry.item === 'string' ? entry.item : '<unnamed>';
    if (seen.has(id)) problems.push(`${id}: duplicate entry`);
    seen.add(id);
    if (!expected.has(id)) problems.push(`${id}: not in the Blocked-by list`);
    const fail = (message) => problems.push(`${id}: ${message}`);
    if (typeof entry.repo !== 'string' || !entry.repo) fail('repo is missing');
    else if (!ALLOWED_REPOSITORIES.includes(entry.repo)) fail(`repository ${entry.repo} is not in the allow-list`);
    if (!isPositiveInteger(entry.issue)) fail('issue number is missing');
    if (entry.state !== 'CLOSED') fail(`issue is not CLOSED (${entry.state})`);
    else if (entry.state_reason !== 'COMPLETED') fail(`closure reason ${entry.state_reason} is not COMPLETED`);
    if (!isPositiveInteger(entry.pr)) fail('PR number is missing');
    if (entry.pr_merged !== true) fail(`PR #${entry.pr} is not merged`);
    // The PR repository is its own recorded fact: it is never defaulted to the issue repository.
    if (typeof entry.pr_repository !== 'string' || !entry.pr_repository) fail('PR repository is missing');
    else if (entry.pr_repository !== entry.repo) fail(`PR repository ${entry.pr_repository} does not match the recorded repository ${entry.repo}`);
    if (entry.pr_issue_ref !== entry.issue) fail(`PR references issue ${entry.pr_issue_ref}, not ${entry.issue}`);
    if (entry.merged_before_close !== true) fail('PR was merged after the issue closed');
    if (typeof entry.merge_commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(entry.merge_commit)) fail('merge commit is missing or malformed');
  }
  for (const id of blockedBy) if (!seen.has(id)) problems.push(`missing from the evidence: ${id}`);
  return problems;
}

export function checkRollback(rollback) {
  const problems = [];
  const fail = (message) => problems.push(`rollback evidence: ${message}`);
  if (!isObject(rollback) || !isObject(rollback.prior)) return ['rollback evidence: prior release is not recorded'];
  const { prior } = rollback;
  if (typeof rollback.image !== 'string' || !/\/in-falcone-web-console$/.test(rollback.image)) fail('image must be the in-falcone-web-console repository');
  if (typeof prior.tag !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prior.tag)) fail('prior.tag is missing');
  if (typeof prior.digest !== 'string' || !SHA256.test(prior.digest)) fail('prior.digest must be a sha256 digest');
  if (typeof prior.source !== 'string' || !prior.source.trim()) fail('prior.source is missing');
  if (typeof prior.verified_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(prior.verified_on) || Number.isNaN(Date.parse(prior.verified_on))) fail('prior.verified_on must be a date');
  const next = rollback.switch_release?.digest;
  if (next !== null && next !== undefined && !(typeof next === 'string' && SHA256.test(next))) fail('switch_release.digest must be null or a sha256 digest');
  return problems;
}

function referencesIssue(pull, repo, issue) {
  const text = `${pull.title ?? ''}\n${pull.body ?? ''}`;
  const patterns = [
    new RegExp(`(?<![\\w/])#${issue}(?!\\d)`),
    new RegExp(`${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#${issue}(?!\\d)`),
    new RegExp(`https://github\\.com/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/issues/${issue}(?!\\d)`)
  ];
  if (patterns.some((pattern) => pattern.test(text))) return true;
  const branch = pull.head?.ref;
  return typeof branch === 'string' && (new RegExp(`(?<!\\d)issue-${issue}(?!\\d)`).test(branch) || new RegExp(`(?:^|/)agent/[^/]+/${issue}/`).test(branch));
}

export async function checkAgainstApi(evidence, fetchJson) {
  const problems = [];
  async function checkEntry(entry) {
    const id = entry.item;
    const fail = (message) => problems.push(`${id}: ${message}`);
    let issue;
    let pull;
    try {
      issue = await fetchJson(`/repos/${entry.repo}/issues/${entry.issue}`);
      pull = await fetchJson(`/repos/${entry.repo}/pulls/${entry.pr}`);
    } catch (error) {
      return fail(`GitHub API check failed: ${error.message}`);
    }
    if (issue.state !== 'closed') fail(`issue is not closed (${issue.state})`);
    else if (!issue.state_reason) fail('issue state reason is missing');
    else if (issue.state_reason !== 'completed') fail(`issue state reason is ${issue.state_reason}, expected completed`);
    if (pull.merged !== true || !pull.merged_at) fail(`PR #${entry.pr} is not merged`);
    const identity = typeof pull.html_url === 'string' ? pull.html_url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/) : null;
    if (!identity) fail('PR identity is unavailable (no usable html_url)');
    else if (identity[1] !== entry.repo) fail(`PR repository ${identity[1]} does not match the recorded repository ${entry.repo}`);
    else if (Number(identity[2]) !== entry.pr) fail(`PR identity ${identity[1]}#${identity[2]} does not match the recorded number ${entry.pr}`);
    if (!referencesIssue(pull, entry.repo, entry.issue)) fail(`PR #${entry.pr} does not reference issue ${entry.issue}`);
    const mergedAt = Date.parse(pull.merged_at);
    const closedAt = Date.parse(issue.closed_at);
    if (Number.isNaN(mergedAt) || Number.isNaN(closedAt)) fail('merged_at or closed_at is unavailable');
    else if (mergedAt > closedAt) fail(`PR #${entry.pr} was merged after the issue closed`);
    if (typeof pull.merge_commit_sha !== 'string' || !pull.merge_commit_sha.startsWith(entry.merge_commit)) {
      fail(`PR merge commit ${pull.merge_commit_sha} does not start with the recorded ${entry.merge_commit}`);
    }
  }
  const queue = [...evidence.items];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) await checkEntry(queue.shift());
  }));
  return problems;
}

function apiClient(env) {
  const base = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  return async (path) => {
    const response = await fetch(`${base}${path}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GITHUB_TOKEN}`, 'x-github-api-version': '2022-11-28', 'user-agent': 'falcone-cutover-gate' },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`${path} answered HTTP ${response.status}`);
    try {
      const body = await response.json();
      if (!isObject(body)) throw new Error('not an object');
      return body;
    } catch {
      throw new Error(`${path} did not answer a JSON object`);
    }
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`);
  }
}

export async function main(argv, env) {
  const args = { evidence: join(root, 'release-evidence/cutover-gate.json'), rollback: join(root, 'release-evidence/web-console-rollback.json'), api: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--api') args.api = true;
    else if (argv[index] === '--evidence' || argv[index] === '--rollback') args[argv[index].slice(2)] = resolve(argv[++index] ?? '');
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  const evidence = readJson(args.evidence, 'cutover evidence');
  const rollback = readJson(args.rollback, 'rollback evidence');
  const problems = [...checkEvidence(evidence), ...checkRollback(rollback)];
  if (args.api) {
    if (!env.GITHUB_TOKEN) problems.push('--api requires GITHUB_TOKEN: the gate fails closed without it');
    else if (!problems.length) problems.push(...await checkAgainstApi(evidence, apiClient(env)));
  }
  if (problems.length) {
    for (const problem of problems) console.error(`cutover gate: ${problem}`);
    console.error(`cutover gate FAILED with ${problems.length} problem(s); the switch must not proceed.`);
    return 1;
  }
  const issues = evidence.items.map((entry) => `${entry.repo}#${entry.issue}`);
  const report = [
    `cutover gate passed: ${evidence.items.length} blocking items, each closed as completed by a merged PR${args.api ? ' (re-checked against the GitHub API)' : ''}.`,
    `issues: ${issues.join(', ')}`,
    `rollback: ${rollback.image}:${rollback.prior.tag} @ ${rollback.prior.digest}`
  ];
  console.log(report.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n### Cutover gate\n\n${report.map((line) => `- ${line}`).join('\n')}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; }, (error) => {
    console.error(`cutover gate: ${error.message}`);
    process.exitCode = 1;
  });
}
