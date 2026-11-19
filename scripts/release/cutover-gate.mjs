import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
function validateEntry(entry) {
  const { item, repo, issue, pr } = entry;
  requireThat(['gntik-ai/falcone', 'gntik-ai/gntik-ui'].includes(repo) && Number.isSafeInteger(issue) && issue > 0, `${item}: invalid issue identity`);
  requireThat(entry.state === 'CLOSED' && entry.stateReason === 'COMPLETED', `${item}: issue must be CLOSED/COMPLETED`);
  requireThat(pr?.repo === repo && Number.isSafeInteger(pr.number) && pr.number > 0, `${item}: missing or mismatched PR repository identity`);
  requireThat(pr.merged === true && /^[a-f0-9]{8,40}$/.test(pr.mergeCommit ?? ''), `${item}: PR is not merged`);
  requireThat(pr.referencesIssue === issue, `${item}: PR references another issue`);
  requireThat(pr.mergedBeforeClosed === true, `${item}: PR merged after closedAt or ordering is unproven`);
}

// The API transport is the only external boundary. Replay fixtures exercise the
// same validation offline; production always uses api.github.com and fails closed.
export async function verifyLiveEntry(entry, get) {
  const [issue, pr] = await Promise.all([
    get(`/repos/${entry.repo}/issues/${entry.issue}`),
    get(`/repos/${entry.repo}/pulls/${entry.pr.number}`),
  ]);
  let urlRepo;
  if (pr.html_url) {
    const url = new URL(pr.html_url);
    const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
    requireThat(url.origin === 'https://github.com' && match && Number(match[2]) === entry.pr.number, `${entry.item}: invalid PR URL identity`);
    urlRepo = match[1];
  }
  const apiRepo = pr.repository?.full_name;
  requireThat(urlRepo || apiRepo, `${entry.item}: missing PR repository identity`);
  requireThat((!urlRepo || urlRepo === entry.repo) && (!apiRepo || apiRepo === entry.repo), `${entry.item}: PR repository mismatch`);
  requireThat(issue.number === entry.issue && pr.number === entry.pr.number, `${entry.item}: API number mismatch`);
  const text = `${pr.title ?? ''}\n${pr.body ?? ''}`;
  const issueUrls = [...text.matchAll(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)(?![0-9])/g)];
  const references = new RegExp(`(^|[^\\w/#])#${entry.issue}(?![0-9])`).test(text) ||
    issueUrls.some((match) => match[1] === entry.repo && Number(match[2]) === entry.issue) ||
    new RegExp(`(?:^|[/_-])issue-${entry.issue}(?:$|[/_-])`).test(pr.head?.ref ?? '');
  const mergedAt = Date.parse(pr.merged_at), closedAt = Date.parse(issue.closed_at);
  validateEntry({ ...entry, state: issue.state?.toUpperCase(), stateReason: issue.state_reason?.toUpperCase(), pr: {
    ...entry.pr, repo: urlRepo ?? apiRepo, merged: pr.merged === true,
    mergeCommit: pr.merge_commit_sha, referencesIssue: references ? entry.issue : null,
    mergedBeforeClosed: Number.isFinite(mergedAt) && Number.isFinite(closedAt) && mergedAt <= closedAt,
  } });
  requireThat(pr.merge_commit_sha?.startsWith(entry.pr.mergeCommit), `${entry.item}: merge commit mismatch`);
}

export async function cutoverGate({ evidence, blocking, rollback, get }) {
  requireThat(JSON.stringify(evidence.blueprint) === JSON.stringify(blocking.blueprint), 'blueprint identity mismatch');
  requireThat(blocking.blockingItems.length === 57 && new Set(blocking.blockingItems).size === 57, 'authoritative blocking list differs from the 57 recorded items');
  const expected = new Set(blocking.blockingItems), seen = new Set();
  requireThat(Array.isArray(evidence.entries), 'missing entries');
  for (const entry of evidence.entries) {
    requireThat(expected.has(entry.item) && !seen.has(entry.item), `unknown or duplicate blocking item: ${entry.item}`);
    seen.add(entry.item);
    validateEntry(entry);
    if (get) await verifyLiveEntry(entry, get);
  }
  requireThat(seen.size === expected.size, 'missing blueprint blocking item');
  requireThat(rollback.repository === 'ghcr.io/gntik-ai/in-falcone-web-console' && rollback.prior?.tag === 'sha-ca5183d' &&
    /^sha256:[a-f0-9]{64}$/.test(rollback.prior?.digest ?? '') && rollback.source && rollback.verifiedAt, 'missing or invalid rollback evidence');
  return `${seen.size} blocking items verified: ${evidence.entries.map((e) => `${e.repo}#${e.issue}`).join(', ')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? new URL(fallback, root) : args[index + 1]; };
  const [evidence, blocking, rollback] = await Promise.all([
    load(option('--evidence', 'release-evidence/cutover-gate.json')),
    load(new URL('release-evidence/cutover-blocking-items.json', root)),
    load(option('--rollback', 'release-evidence/web-console-rollback.json')),
  ]);
  let get;
  const inCi = Boolean(process.env.CI) && !['false', '0'].includes(process.env.CI);
  const replayIndex = args.indexOf('--api-fixture');
  if (replayIndex >= 0) {
    requireThat(!inCi, 'API replay is forbidden in CI');
    const responses = await load(args[replayIndex + 1]);
    get = async (path) => {
      const response = responses[path];
      requireThat(response && !response.apiError, `GitHub API error in offline replay for ${path}`);
      return response;
    };
  }
  if (inCi) {
    requireThat(process.env.GITHUB_TOKEN, 'CI requires GITHUB_TOKEN for live verification');
    get = async (path) => {
      const response = await fetch(`https://api.github.com${path}`, { headers: {
        authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
      } });
      requireThat(response.ok, `GitHub API error ${response.status} for ${path}`);
      return response.json();
    };
  }
  console.log(await cutoverGate({ evidence, blocking, rollback, get }));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`cutover gate: ${error.message}`);
  process.exitCode = 1;
});
