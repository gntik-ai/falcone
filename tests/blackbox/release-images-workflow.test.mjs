import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/release-images.yml');
const workflowText = readFileSync(workflowPath, 'utf8');
const workflow = parse(workflowText);
const buildPush = workflow.jobs?.['build-push'];
const steps = buildPush?.steps ?? [];

function stepNamed(name) {
  return steps.find((step) => step.name === name);
}

test('console host and Docker builds receive the same validated version and source commit', () => {
  const host = stepNamed('Build web-console SPA (vite)');
  const build = steps.find((step) => step.id === 'build');
  assert.equal(host?.env?.VITE_APP_VERSION, '${{ steps.meta.outputs.version }}');
  assert.equal(host?.env?.VITE_APP_COMMIT_SHA, '${{ github.sha }}');
  const next = stepNamed('Build web-console-next SPA (vite)');
  assert.equal(next?.if, host.if);
  assert.equal(next?.env?.VITE_APP_VERSION, host.env.VITE_APP_VERSION);
  assert.equal(next?.env?.VITE_APP_COMMIT_SHA, host.env.VITE_APP_COMMIT_SHA);
  assert.equal(next?.env?.VITE_BASE_PATH, '/next/');
  assert.equal(next?.env?.CSP_TEST_HARNESS, '');
  assert.equal(next?.run, 'pnpm --filter @in-falcone/web-console-next exec vite build');
  assert.match(build?.with?.['build-args'] ?? '', /^APP_VERSION=\$\{\{ steps.meta.outputs.version \}\}$/m);
  assert.match(build?.with?.['build-args'] ?? '', /^APP_COMMIT_SHA=\$\{\{ github.sha \}\}$/m);
  assert.doesNotMatch(build?.with?.['build-args'] ?? '', /token|password|npmrc/i);
});

test('both console bundles are verified at the evidenced digest, including existing-image replays', () => {
  const verify = stepNamed('Verify published image digests');
  const check = stepNamed('Verify published web-console version');
  assert.ok(check, 'published HTML verification step must exist');
  assert.equal(check.if, `${verify.if} && matrix.image == 'in-falcone-web-console'`);
  assert.ok(steps.indexOf(check) > steps.indexOf(verify));
  assert.equal(verify.id, 'published');
  assert.equal(verify.if, "(steps.existing.outputs.skip == 'true' || steps.build.outcome == 'success')");
  assert.equal(check.env.IMAGE_REF, '${{ steps.published.outputs.image_ref }}');
  assert.equal(check.env.VERSION, '${{ steps.meta.outputs.version }}');
});

test('digest verification fails closed and records a single immutable image reference for release evidence', () => {
  const verify = stepNamed('Verify published image digests');
  const directory = mkdtempSync(path.join(tmpdir(), 'console-digest-'));
  const digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  try {
    const docker = path.join(directory, 'docker');
    const output = path.join(directory, 'output');
    const summary = path.join(directory, 'summary');
    writeFileSync(docker, `#!/usr/bin/env bash
if [[ "\u0024{!#}" == registry/image:1.2.3 ]]; then printf '%s' "$VERSION_DIGEST"; else printf '%s' "$SHA_DIGEST"; fi
`);
    chmodSync(docker, 0o755);
    for (const [versionDigest, shaDigest, success] of [
      [digest, digest, true], [digest, 'sha256:different', false], ['', '', false], ['invalid', 'invalid', false]
    ]) {
      writeFileSync(output, '');
      writeFileSync(summary, '');
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', verify.run], {
        encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, IMAGE: 'in-falcone-web-console',
          VERSION_REF: 'registry/image:1.2.3', SHA_REF: 'registry/image:sha-abcdef0',
          VERSION_DIGEST: versionDigest, SHA_DIGEST: shaDigest, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }
      });
      assert.equal(result.status, success ? 0 : 1, result.stdout + result.stderr);
      if (success) {
        assert.ok(readFileSync(output, 'utf8').includes(`image_ref=registry/image@${digest}`));
        assert.ok(readFileSync(summary, 'utf8').includes(`registry/image@${digest}`));
      } else {
        assert.equal(readFileSync(output, 'utf8'), '');
        assert.equal(readFileSync(summary, 'utf8'), '');
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('published console check fails closed and appends the verified version to digest evidence', () => {
  const check = stepNamed('Verify published web-console version');
  assert.ok(check?.run, 'published HTML verification script must exist');
  const directory = mkdtempSync(path.join(tmpdir(), 'console-published-'));
  try {
    const dockerPath = path.join(directory, 'docker');
    const htmlPath = path.join(directory, 'fixture.html');
    const nextHtmlPath = path.join(directory, 'next.html');
    const summaryPath = path.join(directory, 'summary');
    const callsPath = path.join(directory, 'calls');
    writeFileSync(dockerPath, `#!/usr/bin/env bash
echo "$*" >> "$CALLS"
case "$1" in
  create) echo fixture-container ;;
  cp) if [[ "$2" == *:/app/dist-next/index.html ]]; then cp "$NEXT_HTML_FIXTURE" "$3"; else cp "$HTML_FIXTURE" "$3"; fi ;;
  rm) exit 0 ;;
  *) echo 'unexpected Docker mutation' >&2; exit 1 ;;
esac
`);
    chmodSync(dockerPath, 0o755);
    const valid = '<meta name="version" content="1.2.3" />';
    for (const [html, nextHtml, success] of [
      [valid, valid, true],
      ['<meta name="version" content="dev" />', valid, false],
      [valid, '<meta name="version" content="dev" />', false],
      ['<html></html>', valid, false],
      [valid, '<html></html>', false],
      [valid, '<meta name="version" content="1.2.30" />', false],
      [valid, `${valid}<meta name="version" content="dev" />`, false],
      [valid, null, false],
    ]) {
      writeFileSync(htmlPath, html);
      if (nextHtml === null) rmSync(nextHtmlPath, { force: true });
      else writeFileSync(nextHtmlPath, nextHtml);
      writeFileSync(callsPath, '');
      const evidence = '### in-falcone-web-console published\n\nregistry/image:1.2.3 and registry/image:sha-abcdef0 both resolve to `sha256:matching`.\n';
      writeFileSync(summaryPath, evidence);
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', check.run], {
        encoding: 'utf8',
        env: {...process.env, PATH: `${directory}:${process.env.PATH}`, IMAGE_REF: 'registry/image@sha256:matching',
          VERSION: '1.2.3', HTML_FIXTURE: htmlPath, NEXT_HTML_FIXTURE: nextHtmlPath, CALLS: callsPath, GITHUB_STEP_SUMMARY: summaryPath},
      });
      assert.equal(result.status, success ? 0 : 1, result.stderr);
      const summary = readFileSync(summaryPath, 'utf8');
      assert.ok(summary.startsWith(evidence), 'digest evidence is preserved');
      if (success) assert.match(summary.slice(evidence.length), /Verified.*1\.2\.3/);
      else {
        assert.match(result.stdout + result.stderr, /::error::/);
        assert.equal(summary, evidence);
      }
      const calls = readFileSync(callsPath, 'utf8');
      assert.match(calls, /^create --pull=always registry\/image@sha256:matching$/m);
      assert.match(calls, /^cp fixture-container:\/app\/dist\/index\.html /m);
      if (success) assert.match(calls, /^cp fixture-container:\/app\/dist-next\/index\.html /m);
      assert.match(calls, /^rm fixture-container$/m);
    }
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('bbx-1026-001: release images publishes tag pushes and serializes duplicate release events', () => {
  assert.deepEqual(workflow.on?.push?.tags, ['v*.*.*']);
  assert.deepEqual(workflow.on?.release?.types, ['published']);
  assert.deepEqual(Object.keys(workflow.on?.workflow_dispatch?.inputs ?? {}).sort(), [
    'publish_fn_runtime',
    'push_latest',
    'tag',
  ]);
  assert.equal(workflow.on?.workflow_dispatch?.inputs?.tag?.required, true);
  assert.equal(workflow.on?.workflow_dispatch?.inputs?.push_latest?.default, false);
  assert.equal(workflow.on?.workflow_dispatch?.inputs?.publish_fn_runtime?.default, true);
  assert.match(workflow.concurrency?.group ?? '', /github\.ref_name/);
  assert.match(workflow.concurrency?.group ?? '', /startsWith\(inputs\.tag, 'v'\)/);
  assert.equal(workflow.concurrency?.['cancel-in-progress'], false);
  assert.equal(buildPush?.['runs-on'], 'ubuntu-latest');
  assert.equal(buildPush?.strategy?.matrix?.include?.length, 6);
  assert.doesNotMatch(workflowText, /self-hosted/i);
});

test('bbx-1026-002: image tags use the workflow commit SHA and strict validated versions', () => {
  const meta = stepNamed('Resolve version and registry namespace');
  const tags = stepNamed('Compute image tags');
  assert.match(meta?.run ?? '', /\^v\?\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
  assert.match(meta?.run ?? '', /short_sha="\$\{SHA:0:7\}"/);
  assert.equal(meta?.env?.REF_NAME, '${{ github.ref_name }}');
  assert.equal(meta?.env?.INPUT_TAG, '${{ inputs.tag }}');
  assert.match(tags?.run ?? '', /sha-\$\{SHORT_SHA\}/);
  assert.match(tags?.run ?? '', /echo "\$\{base\}:\$\{VERSION\}"/);
  assert.match(tags?.run ?? '', /echo "\$\{base\}:sha-\$\{SHORT_SHA\}"/);
});

test('bbx-1026-003: existing image checks and post-push digest verification fail closed', () => {
  const existing = stepNamed('Check existing immutable image tags');
  const verify = stepNamed('Verify published image digests');
  assert.match(existing?.run ?? '', /docker buildx imagetools inspect/);
  assert.match(existing?.run ?? '', /--format '\{\{\.Manifest\.Digest\}\}'/);
  assert.doesNotMatch(existing?.run ?? '', /2>&1/);
  assert.match(existing?.run ?? '', /skip=true/);
  assert.match(existing?.run ?? '', /different digests/);
  assert.match(verify?.run ?? '', /docker buildx imagetools inspect/);
  assert.match(verify?.run ?? '', /--format '\{\{\.Manifest\.Digest\}\}'/);
  assert.match(verify?.run ?? '', /different digests/);
  assert.match(verify?.run ?? '', /GITHUB_STEP_SUMMARY/);
});

test('bbx-1026-006: disabled manual function runtime does not probe or build its image', () => {
  const existing = stepNamed('Check existing immutable image tags');
  assert.equal(
    existing?.if,
    "github.event_name != 'workflow_dispatch' || matrix.image != 'in-falcone-fn-runtime' || inputs.publish_fn_runtime",
  );
});

test('bbx-1026-004: existing image check handles docker results under bash -e', () => {
  const existing = stepNamed('Check existing immutable image tags');
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'release-images-workflow-'));
  const dockerPath = path.join(fixtureDirectory, 'docker');
  const outputPath = path.join(fixtureDirectory, 'output');
  const summaryPath = path.join(fixtureDirectory, 'summary');
  writeFileSync(dockerPath, `#!/usr/bin/env bash
case "$CASE:$*" in
  missing:*) echo 'manifest unknown' >&2; exit 1 ;;
  match:*) echo 'sha256:matching' ;;
  mismatch:*version) echo 'sha256:version' ;;
  mismatch:*sha) echo 'sha256:sha' ;;
  partial:*version) echo 'sha256:version' ;;
  partial:*sha) echo 'manifest unknown' >&2; exit 1 ;;
  error:*) echo 'denied' >&2; exit 1 ;;
esac
`);
  chmodSync(dockerPath, 0o755);
  writeFileSync(outputPath, '');
  writeFileSync(summaryPath, '');

  const runCase = (scenario) => {
    writeFileSync(outputPath, '');
    writeFileSync(summaryPath, '');
    return spawnSync('bash', ['-e', '-c', existing.run], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CASE: scenario,
        PATH: `${fixtureDirectory}:${process.env.PATH}`,
        VERSION_REF: 'registry.example/image:version',
        SHA_REF: 'registry.example/image:sha',
        IMAGE: 'image',
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    });
  };

  const missing = runCase('missing');
  assert.equal(missing.status, 0, missing.stderr);
  assert.match(readFileSync(outputPath, 'utf8'), /skip=false/);

  const matching = runCase('match');
  assert.equal(matching.status, 0, matching.stderr);
  assert.match(readFileSync(outputPath, 'utf8'), /skip=true/);

  for (const scenario of ['mismatch', 'partial', 'error']) {
    const result = runCase(scenario);
    assert.equal(result.status, 1, `${scenario}: ${result.stderr}`);
  }
});

test('bbx-1026-005: untrusted tags are not interpolated into run scripts and no credentials broaden', () => {
  for (const step of steps.filter((step) => typeof step.run === 'string')) {
    assert.doesNotMatch(step.run, /\$\{\{\s*github\.ref_name\s*\}\}/);
    assert.doesNotMatch(step.run, /\$\{\{\s*github\.event\.inputs\.tag\s*\}\}/);
  }
  assert.equal(workflow.permissions?.contents, 'read');
  assert.equal(workflow.permissions?.packages, 'write');
  // Only the GHCR token and the Docker Hub pull credentials (authenticated base-image pulls).
  assert.doesNotMatch(workflowText, /secrets\.(?!(?:GITHUB_TOKEN|DOCKERHUB_USERNAME|DOCKERHUB_TOKEN)\b)/);
  const dockerHubUses = workflowText.match(/secrets\.DOCKERHUB_(?:USERNAME|TOKEN)\b/g) ?? [];
  assert.equal(dockerHubUses.length, 2, 'Docker Hub secrets are used once each, by the docker.io login');
  assert.doesNotMatch(workflowText, /(?:token|password)\s*:\s*.*\bPAT\b/i);
});
