import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
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

test('bbx-1026-003: release deduplication and post-push digest verification fail closed', () => {
  const existing = stepNamed('Skip already-published image');
  const verify = stepNamed('Verify published image digests');
  assert.match(existing?.if ?? '', /workflow_dispatch/);
  assert.match(existing?.run ?? '', /docker buildx imagetools inspect/);
  assert.match(existing?.run ?? '', /skip=true/);
  assert.match(existing?.run ?? '', /different digests/);
  assert.match(verify?.run ?? '', /docker buildx imagetools inspect/);
  assert.match(verify?.run ?? '', /different digests/);
  assert.match(verify?.run ?? '', /GITHUB_STEP_SUMMARY/);
});

test('bbx-1026-004: untrusted tags are not interpolated into run scripts and no credentials broaden', () => {
  for (const step of steps.filter((step) => typeof step.run === 'string')) {
    assert.doesNotMatch(step.run, /\$\{\{\s*github\.ref_name\s*\}\}/);
    assert.doesNotMatch(step.run, /\$\{\{\s*github\.event\.inputs\.tag\s*\}\}/);
  }
  assert.equal(workflow.permissions?.contents, 'read');
  assert.equal(workflow.permissions?.packages, 'write');
  assert.doesNotMatch(workflowText, /secrets\.(?!GITHUB_TOKEN)/);
  assert.doesNotMatch(workflowText, /(?:token|password)\s*:\s*.*\bPAT\b/i);
});
