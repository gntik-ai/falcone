import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
  assert.deepEqual(buildPush.concurrency, {
    group: 'release-images-publish-${{ matrix.image }}', 'cancel-in-progress': false, queue: 'max',
  });
  assert.equal(buildPush?.['runs-on'], 'ubuntu-24.04');
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
  for (const secret of ['USERNAME', 'TOKEN']) {
    assert.equal(workflowText.split(`secrets.DOCKERHUB_${secret}`).length - 1, 4);
  }
  assert.doesNotMatch(workflowText, /(?:token|password)\s*:\s*.*\bPAT\b/i);
});


test('bbx-1101-preflight: credentials gate builds without exposing values', () => {
  const preflight = workflow.jobs.preflight;
  assert.deepEqual(preflight?.permissions, {});
  assert.deepEqual(preflight.steps.map(({name}) => name), ['Check Docker Hub credentials', 'Log in to Docker Hub']);
  assert.equal(buildPush.needs, 'preflight');
  assert.equal(buildPush.permissions, undefined);
  const [check, login] = preflight.steps;
  assert.deepEqual(check.env, {DOCKERHUB_USERNAME: '${{ secrets.DOCKERHUB_USERNAME }}', DOCKERHUB_TOKEN: '${{ secrets.DOCKERHUB_TOKEN }}'});
  assert.equal(login.uses, 'docker/login-action@9780b0c442fbb1117ed29e0efdff1e18412f7567');
  assert.deepEqual(login.with, {registry: 'docker.io', username: '${{ secrets.DOCKERHUB_USERNAME }}', password: '${{ secrets.DOCKERHUB_TOKEN }}'});
  assert.equal(login.if, undefined);
  assert.equal(stepNamed('Log in to Docker Hub (base-image pulls)').if, undefined);
  for (const [username, token, missing] of [
    ['', 'fixture-token', ['DOCKERHUB_USERNAME']],
    ['fixture-user', '', ['DOCKERHUB_TOKEN']],
    ['', '', ['DOCKERHUB_USERNAME', 'DOCKERHUB_TOKEN']],
    ['fixture-user', 'fixture-token', []],
  ]) {
    const result = spawnSync('bash', ['-e', '-c', check.run], {
      encoding: 'utf8', env: {...process.env, DOCKERHUB_USERNAME: username, DOCKERHUB_TOKEN: token},
    });
    assert.equal(result.status, missing.length ? 1 : 0);
    const output = result.stdout + result.stderr;
    assert.deepEqual([...output.matchAll(/::error::(DOCKERHUB_\w+) is empty/g)].map((m) => m[1]), missing);
    assert.doesNotMatch(output, /fixture-token|fixture-user/);
  }
});

test('bbx-1101-ci: workflow fixtures run unconditionally after unit tests', () => {
  const ci = parse(readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8'));
  const qualitySteps = ci.jobs.quality.steps;
  const index = qualitySteps.findIndex(({name}) => name === 'Unit tests');
  assert.deepEqual(qualitySteps[index + 1], {
    name: 'Release images workflow tests', run: 'node --test tests/blackbox/release-images-workflow.test.mjs',
  });
});

const hub = () => workflow.jobs['dockerhub-publish'];
const hubStep = (name) => hub()?.steps.find((step) => step.name === name);
const fnCondition = "github.event_name != 'workflow_dispatch' || matrix.image != 'in-falcone-fn-runtime' || inputs.publish_fn_runtime";

test('bbx-1101-login-actions: new credential consumers use an immutable v3 action commit', () => {
  for (const step of [workflow.jobs.preflight.steps[1], ...hub().steps.filter(({uses}) => uses)]) {
    assert.equal(step.uses, 'docker/login-action@9780b0c442fbb1117ed29e0efdff1e18412f7567', step.name);
  }
});

test('bbx-1101-dockerhub-job-isolation', () => {
  assert.equal(workflow.env.DOCKERHUB_NAMESPACE, 'gntik');
  assert.equal(workflow.concurrency, undefined);
  assert.equal(hub()?.needs, 'build-push');
  assert.deepEqual(hub().strategy, buildPush.strategy);
  assert.deepEqual(hub().permissions, {contents: 'read', packages: 'read'});
  assert.deepEqual(hub().concurrency, {group: 'release-images-dockerhub-${{ matrix.image }}', 'cancel-in-progress': false, queue: 'max'});
  assert.equal(hub()['timeout-minutes'], 30);
  assert.deepEqual(hub().steps.map(({name}) => name), [
    'Resolve version and registry namespace', 'Log in to GHCR (read)', 'Log in to Docker Hub',
    'Resolve GHCR digest', 'Copy release tags to Docker Hub', 'Reconcile Docker Hub latest',
  ]);
  for (const step of steps.filter(({name}) => name !== 'Log in to Docker Hub (base-image pulls)')) {
    assert.doesNotMatch(JSON.stringify(step), /imagetools create|hub\.docker\.com|DOCKERHUB_NAMESPACE|docker\.io/);
  }
  const {if: condition, ...meta} = hub().steps[0];
  assert.deepEqual(meta, stepNamed('Resolve version and registry namespace'));
  assert.deepEqual(hub().steps[1].with, {registry: 'ghcr.io', username: '${{ github.actor }}', password: '${{ secrets.GITHUB_TOKEN }}'});
  assert.deepEqual(hub().steps[2].with, workflow.jobs.preflight.steps[1].with);
});

test('bbx-1101-dockerhub-fn-runtime-condition', () => {
  assert.ok(hub());
  for (const step of hub().steps) assert.equal(step.if, fnCondition);
});

// System-boundary stubs enforce an ordered registry protocol and record every call.
const digest = 'sha256:bafebd36189ad3688b7b3915ea55d461e0bfcfbdde11e54b0a123999fb6be50f';
const otherDigest = `sha256:${'b'.repeat(64)}`;
const manifest = '{"schemaVersion":2}';
const ghcrBase = 'ghcr.io/gntik-ai/in-falcone-control-plane';
const hubBase = 'docker.io/gntik/in-falcone-control-plane';
const versionRef = `${hubBase}:1.2.3`;
const shaRef = `${hubBase}:sha-abcdef0`;
const sourceRef = `${ghcrBase}@${digest}`;
const inspect = (ref, result = digest) => ({tool: 'docker', kind: 'inspect', ref,
  ...(result.startsWith('sha256:') ? {stdout: result} : {code: 1, stderr: result})});
const lookup = (status = 200, isPrivate = false) => ({tool: 'curl', status, body: {is_private: isPrivate}});
const dryRun = (ref, stdout = `${manifest}\n`) => ({tool: 'docker', kind: 'dry-run', refs: [ref], stdout});
const create = (refs, extra = {}) => ({tool: 'docker', kind: 'create', refs, ...extra});

function registryFixture(step, plan, extraEnv = {}) {
  assert.ok(step?.run, 'extractable workflow script exists');
  const directory = mkdtempSync(path.join(tmpdir(), 'dockerhub-release-'));
  try {
    const stub = `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
fs.appendFileSync(process.env.CALLS, JSON.stringify({tool, args}) + '\\n');
const plan = JSON.parse(fs.readFileSync(process.env.PLAN, 'utf8'));
const index = Number(fs.readFileSync(process.env.CURSOR, 'utf8'));
const entry = plan[index];
assert.ok(entry, 'unexpected extra call: ' + tool + ' ' + args.join(' '));
assert.equal(entry.tool, tool);
if (tool === 'curl') {
  assert.deepEqual(args.slice(0, 2), ['-sS', '-o']);
  assert.deepEqual(args.slice(3), ['-w', '%{http_code}', 'https://hub.docker.com/v2/repositories/gntik/in-falcone-control-plane/']);
  fs.writeFileSync(args[2], JSON.stringify(entry.body));
} else {
  assert.deepEqual(args.slice(0, 2), ['buildx', 'imagetools']);
  if (entry.kind === 'inspect') {
    assert.deepEqual(args.slice(2), ['inspect', '--format', '{{.Manifest.Digest}}', entry.ref]);
  } else {
    assert.deepEqual(args.slice(2), ['create', ...(entry.kind === 'dry-run' ? ['--dry-run'] : []), '--prefer-index=false', ...entry.refs.flatMap((ref) => ['-t', ref]), process.env.GHCR_REF]);
  }
}
fs.writeFileSync(process.env.CURSOR, String(index + 1));
if (entry.stderr) process.stderr.write(entry.stderr);
process.stdout.write(tool === 'curl' ? String(entry.status) : (entry.stdout ?? ''));
process.exit(entry.code ?? 0);
`;
    for (const tool of ['docker', 'curl']) {
      const stubPath = path.join(directory, tool);
      writeFileSync(stubPath, stub);
      chmodSync(stubPath, 0o755);
    }
    for (const [file, content] of Object.entries({plan: JSON.stringify(plan), cursor: '0', calls: '', summary: '', output: ''})) {
      writeFileSync(path.join(directory, file), content);
    }
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      encoding: 'utf8', env: {...process.env, PATH: `${directory}:${process.env.PATH}`,
        PLAN: path.join(directory, 'plan'), CURSOR: path.join(directory, 'cursor'), CALLS: path.join(directory, 'calls'),
        GITHUB_STEP_SUMMARY: path.join(directory, 'summary'), GITHUB_OUTPUT: path.join(directory, 'output'),
        IMAGE: 'in-falcone-control-plane', DOCKERHUB_NAMESPACE: 'gntik', VERSION: '1.2.3', SHORT_SHA: 'abcdef0',
        NAMESPACE: 'ghcr.io/gntik-ai', DIGEST: digest, GHCR_REF: sourceRef,
        DOCKERHUB_VISIBILITY_RETRY_DELAY: '0', DOCKERHUB_TOKEN: 'fixture-token-never-send', ...extraEnv},
    });
    const calls = readFileSync(path.join(directory, 'calls'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.doesNotMatch(result.stdout + result.stderr, /AssertionError|fixture-token-never-send/);
    assert.equal(Number(readFileSync(path.join(directory, 'cursor'), 'utf8')), plan.length, result.stdout + result.stderr);
    for (const call of calls.filter(({tool}) => tool === 'curl')) {
      assert.doesNotMatch(JSON.stringify(call.args), /Authorization|fixture-token-never-send|"-u"/);
    }
    return {...result, text: result.stdout + result.stderr, calls,
      summary: readFileSync(path.join(directory, 'summary'), 'utf8'), output: readFileSync(path.join(directory, 'output'), 'utf8')};
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

test('bbx-1101-resolve: derive a validated source digest from both GHCR immutable tags', () => {
  const step = hubStep('Resolve GHCR digest');
  const version = `${ghcrBase}:1.2.3`;
  const sha = `${ghcrBase}:sha-abcdef0`;
  const result = registryFixture(step, [inspect(version), inspect(sha)]);
  assert.equal(result.status, 0, result.text);
  assert.ok(result.output.includes(`DIGEST=${digest}\n`));
  assert.ok(result.output.includes(`GHCR_REF=${sourceRef}\n`));
  for (const bad of [otherDigest, 'sha256:invalid', 'unauthorized']) {
    const result = registryFixture(step, [inspect(version), inspect(sha, bad)]);
    assert.equal(result.status, 1, result.text);
    assert.equal(result.output, '');
    assert.match(result.text, /::error::/);
  }
});

function copyFixture(plan, status = 0) {
  const result = registryFixture(hubStep('Copy release tags to Docker Hub'), plan);
  assert.equal(result.status, status, result.text);
  if (status) assert.match(result.text, /::error::/);
  return result;
}
const missingTags = (error = 'manifest unknown') => [inspect(versionRef, error), inspect(shaRef, error)];
const verifiedTags = () => [inspect(versionRef), inspect(shaRef)];
const copyTags = () => [dryRun(versionRef), create([versionRef, shaRef])];

test('bbx-1101-copy-6a: missing tags copy once after a digest-matching dry-run', () => {
  const result = copyFixture([lookup(), ...missingTags(), ...copyTags(), ...verifiedTags(), lookup()]);
  for (const value of [sourceRef, digest, versionRef, shaRef, 'copied', 'public']) assert.ok(result.summary.includes(value), result.summary);
});

test('bbx-1101-copy-6b: equal immutable tags cause zero creates and still check visibility', () => {
  const result = copyFixture([lookup(), ...verifiedTags(), ...verifiedTags(), lookup()]);
  assert.equal(result.calls.filter(({args}) => args.includes('create')).length, 0);
  assert.match(result.summary, /unchanged/);
});

test('bbx-1101-copy: a single missing tag copies only that ref', () => {
  copyFixture([lookup(), inspect(versionRef), inspect(shaRef, 'name unknown'),
    dryRun(shaRef), create([shaRef]), ...verifiedTags(), lookup()]);
});

test('bbx-1101-copy-6c: a conflict on either immutable tag fails before all writes', () => {
  for (const [version, sha, conflict] of [[otherDigest, 'not found', versionRef], ['not found', otherDigest, shaRef]]) {
    const result = copyFixture([lookup(), inspect(versionRef, version), inspect(shaRef, sha)], 1);
    assert.ok(result.text.includes(conflict), result.text);
  }
});

test('bbx-1101-copy-6d: dry-run mismatch or failure never pushes', () => {
  for (const dry of [dryRun(versionRef, '{"different":true}'), {...dryRun(versionRef), code: 1, stderr: 'dry-run error'}]) {
    copyFixture([lookup(), ...missingTags(), dry], 1);
  }
});

test('bbx-1101-copy-6e: denied push names the affected refs and makes no further writes', () => {
  const result = copyFixture([lookup(), ...missingTags(), dryRun(versionRef),
    create([versionRef, shaRef], {code: 1, stderr: 'denied'})], 1);
  assert.ok(result.text.includes(versionRef));
  assert.ok(result.text.includes(shaRef));
});

test('bbx-1101-copy-6f: a post-copy digest mismatch fails closed', () => {
  const result = copyFixture([lookup(), ...missingTags(), ...copyTags(), inspect(versionRef, otherDigest)], 1);
  assert.ok(result.text.includes(versionRef));
});

test('bbx-1101-copy-6g: public repo inspect errors never write', () => {
  for (const error of ['unauthorized', 'toomanyrequests', 'connection refused']) {
    copyFixture([lookup(), inspect(versionRef, error), inspect(shaRef, 'not found')], 1);
  }
});

test('bbx-1101-copy-6h: absent repos allow denial or not-found, then verify public visibility on retry', () => {
  for (const error of ['denied', 'unauthorized', 'insufficient_scope', 'not found']) {
    const result = copyFixture([lookup(404), ...missingTags(error), ...copyTags(), ...verifiedTags(), lookup(404), lookup()]);
    assert.match(result.summary, /absent or private/);
  }
  copyFixture([lookup(404), inspect(versionRef, 'toomanyrequests'), inspect(shaRef, 'not found')], 1);
});

test('bbx-1101-copy-6i: a hidden existing tag is never overwritten', () => {
  const result = copyFixture([lookup(404), ...verifiedTags()], 1);
  assert.match(result.text, /exists but is not public/);
});

test('bbx-1101-copy-6j: private auto-created repos and six not-found visibility checks fail', () => {
  for (const checks of [[lookup(200, true)], Array.from({length: 6}, () => lookup(404))]) {
    const result = copyFixture([lookup(404), ...missingTags('denied'), ...copyTags(), ...verifiedTags(), ...checks], 1);
    assert.ok(result.text.includes(hubBase));
    assert.match(result.text, /missing or not public/);
  }
  // Visibility also gates no-copy replays and fails immediately on errors other than 404.
  copyFixture([lookup(), ...verifiedTags(), ...verifiedTags(), lookup(200, true)], 1);
  copyFixture([lookup(), ...missingTags(), ...copyTags(), ...verifiedTags(), lookup(500)], 1);
});

test('bbx-1101-copy-6k: lookup server errors, malformed responses and curl failures precede writes', () => {
  for (const response of [lookup(500), {...lookup(), code: 6}, {...lookup(), body: {}}, {...lookup(), body: {is_private: 'false'}}, lookup(200, true)]) {
    copyFixture([response], 1);
  }
});

const ghcrLatest = `${ghcrBase}:latest`;
const hubLatest = `${hubBase}:latest`;
function latestFixture(plan, status = 0) {
  const result = registryFixture(hubStep('Reconcile Docker Hub latest'), plan);
  assert.equal(result.status, status, result.text);
  if (status) assert.match(result.text, /::error::/);
  return result;
}

test('bbx-1101-latest-7a/7b: repair missing or differing Hub latest from observed GHCR latest', () => {
  for (const current of ['manifest unknown', otherDigest]) {
    const result = latestFixture([inspect(ghcrLatest), inspect(hubLatest, current), dryRun(hubLatest),
      create([hubLatest]), inspect(hubLatest), inspect(ghcrLatest)]);
    for (const value of [sourceRef, hubLatest, digest, 'copied']) assert.ok(result.summary.includes(value), result.summary);
  }
});

test('bbx-1101-latest: equal latest is a no-op on a replay', () => {
  const result = latestFixture([inspect(ghcrLatest), inspect(hubLatest)]);
  assert.match(result.summary, /unchanged/);
});

test('bbx-1101-latest-7c: missing or different GHCR latest never writes', () => {
  for (const current of ['manifest unknown', otherDigest]) {
    const result = latestFixture([inspect(ghcrLatest, current)]);
    assert.match(result.summary, /skipped/);
  }
});

test('bbx-1101-latest-7d: GHCR latest changing or disappearing after a write fails with the ref', () => {
  for (const changed of [otherDigest, 'not found', 'connection refused']) {
    const result = latestFixture([inspect(ghcrLatest), inspect(hubLatest, 'not found'), dryRun(hubLatest),
      create([hubLatest]), inspect(hubLatest), inspect(ghcrLatest, changed)], 1);
    assert.ok(result.text.includes(ghcrLatest), result.text);
  }
});

test('bbx-1101-latest-7e/7f: GHCR and Hub inspect errors fail before any create', () => {
  for (const error of ['unauthorized', 'toomanyrequests', 'connection refused']) {
    latestFixture([inspect(ghcrLatest, error)], 1);
    latestFixture([inspect(ghcrLatest), inspect(hubLatest, error)], 1);
  }
});

test('bbx-1101-latest: dry-run mismatch/failure, push denial and post-copy mismatch fail closed', () => {
  const before = [inspect(ghcrLatest), inspect(hubLatest, 'not found')];
  for (const dry of [dryRun(hubLatest, '{}'), {...dryRun(hubLatest), code: 1}]) {
    latestFixture([...before, dry], 1);
  }
  const denied = latestFixture([...before, dryRun(hubLatest), create([hubLatest], {code: 1, stderr: 'denied'})], 1);
  assert.ok(denied.text.includes(hubLatest));
  latestFixture([...before, dryRun(hubLatest), create([hubLatest]), inspect(hubLatest, otherDigest)], 1);
});

test('bbx-1101-watcher: a cancelled release fails loudly with a rerun command', () => {
  const watcher = parse(readFileSync(path.join(repoRoot, '.github/workflows/release-images-cancelled.yml'), 'utf8'));
  assert.deepEqual(watcher.on, {workflow_run: {workflows: ['release-images'], types: ['completed']}});
  assert.deepEqual(watcher.permissions, {});
  assert.equal(Object.keys(watcher.jobs).length, 1);
  const job = Object.values(watcher.jobs)[0];
  assert.equal(job.if, "github.event.workflow_run.conclusion == 'cancelled'");
  assert.equal(job.steps.length, 1);
  const [step] = job.steps;
  assert.equal(step.name, 'Fail on cancelled release run');
  assert.deepEqual(step.env, {RUN_ID: '${{ github.event.workflow_run.id }}', RUN_URL: '${{ github.event.workflow_run.html_url }}'});
  assert.doesNotMatch(step.run, /\$\{\{/);
  const result = spawnSync('bash', ['-e', '-c', step.run], {
    encoding: 'utf8', env: {...process.env, RUN_ID: '123', RUN_URL: 'https://github.com/gntik-ai/falcone/actions/runs/123'},
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::.*123.*gh run rerun 123/);
  assert.match(result.stdout, /\(https:\/\/github\.com\/gntik-ai\/falcone\/actions\/runs\/123\)/);
});

test('bbx-1101-gates: no failure bypasses, credential leaks or expressions in shell scripts', () => {
  assert.deepEqual(workflow.permissions, {contents: 'read', packages: 'write'});
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.hasOwn(value, 'continue-on-error'), false);
    for (const child of Object.values(value)) walk(child);
  };
  walk(workflow);
  for (const job of [buildPush, hub()]) {
    for (const entry of [job, ...job.steps]) {
      assert.doesNotMatch(entry.if ?? '', /always\(\)|!cancelled\(\)|failure\(\)/);
      if (entry.run) assert.doesNotMatch(entry.run, /\$\{\{/);
    }
  }
  for (const step of hub().steps) {
    for (const line of (step.run ?? '').split('\n').filter((line) => line.includes('imagetools create'))) {
      assert.match(line, /--prefer-index=false/);
    }
  }
  assert.doesNotMatch(hubStep('Reconcile Docker Hub latest').if, /push_latest/);
  assert.equal(hubStep('Resolve GHCR digest').env.DIGEST, undefined);
  for (const name of ['Copy release tags to Docker Hub', 'Reconcile Docker Hub latest']) {
    const env = hubStep(name).env;
    assert.equal(env.DIGEST, '${{ steps.source.outputs.DIGEST }}');
    assert.equal(env.GHCR_REF, '${{ steps.source.outputs.GHCR_REF }}');
  }
});


test('bbx-1101-preservation: existing GHCR steps, triggers and workflow permissions stay byte-identical', () => {
  // Fixed fingerprints of the approved source snapshot, independent of the changed workflow.
  const fingerprint = (text) => createHash('sha256').update(text).digest('hex');
  const buildBlock = workflowText.slice(workflowText.indexOf('  build-push:'), workflowText.indexOf('  # Registry work is isolated:'));
  const originalSteps = buildBlock.slice(buildBlock.indexOf('    steps:')).trimEnd() + '\n';
  assert.equal(fingerprint(originalSteps), 'de03d947cb1d7b8982d2f5f197a8130d3c66e038f71fe3ab59690e5390ba285d');
  assert.equal(fingerprint(workflowText.slice(workflowText.indexOf('\non:'), workflowText.indexOf('\nenv:'))),
    'dbd47472dd8bdf0c7ed3dffe3eaabdaceeb3164dfc4d0d24ec7b2e8fe19a0a47');
});
