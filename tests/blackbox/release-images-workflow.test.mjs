import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
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
  assert.match(existing?.run ?? '', /skip=true/);
  assert.match(existing?.run ?? '', /different digests/);
  assert.match(verify?.run ?? '', /docker buildx imagetools inspect/);
  assert.match(verify?.run ?? '', /different digests/);
  assert.match(verify?.run ?? '', /GITHUB_STEP_SUMMARY/);
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
  assert.doesNotMatch(workflowText, /secrets\.(?!GITHUB_TOKEN)/);
  assert.doesNotMatch(workflowText, /(?:token|password)\s*:\s*.*\bPAT\b/i);
});
