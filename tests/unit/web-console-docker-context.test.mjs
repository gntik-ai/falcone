import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '..', '..');

// A model of Docker's .dockerignore matching (moby patternmatcher): patterns apply in order, the last one that
// matches the path, or one of its parent directories, decides; "!" re-includes.
function compilePattern(line) {
  const exclusion = line.startsWith('!');
  const body = (exclusion ? line.slice(1) : line).replace(/^\/+/, '').replace(/\/+$/, '');
  let source = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '*' && body[index + 1] === '*') {
      if (body[index + 2] === '/') { source += '(?:.*/)?'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return { exclusion, regex: new RegExp(`^${source}$`) };
}

function loadPatterns() {
  return readFileSync(resolve(repoRoot, '.dockerignore'), 'utf8')
    .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map(compilePattern);
}

function isIgnored(patterns, path) {
  const parts = path.split('/');
  const candidates = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  let ignored = false;
  for (const pattern of patterns) {
    if (pattern.exclusion !== ignored) continue;
    if (candidates.some((candidate) => pattern.regex.test(candidate))) ignored = !pattern.exclusion;
  }
  return ignored;
}

test('the docker build context contains the next dist that both console images copy', () => {
  const patterns = loadPatterns();
  for (const path of [
    'apps/web-console-next/dist', 'apps/web-console-next/dist/index.html',
    'apps/web-console-next/dist/assets/index-abc123.js', 'apps/web-console-next/dist/assets/img/icon-180.png'
  ]) assert.equal(isIgnored(patterns, path), false, `${path} must be in the build context`);
});

test('the docker build context still excludes node_modules, other dist directories and the legacy bundle', () => {
  const patterns = loadPatterns();
  for (const path of [
    'node_modules/x/index.js', 'apps/web-console-next/node_modules/react/index.js', 'apps/web-console/dist/index.html',
    'apps/control-plane/dist/main.js', '.git/HEAD', 'apps/web-console-next/test-results/a.json'
  ]) assert.equal(isIgnored(patterns, path), true, `${path} must stay out of the build context`);
  assert.equal(isIgnored(patterns, 'apps/web-console/static-server.mjs'), false);
});

test('every COPY source of the console Dockerfiles that is a build artifact is inside the build context', () => {
  const patterns = loadPatterns();
  for (const dockerfile of ['deploy/kind/web-console/Dockerfile', 'apps/web-console/Dockerfile']) {
    const copies = readFileSync(resolve(repoRoot, dockerfile), 'utf8').split('\n')
      .filter((line) => /^COPY\s/.test(line) && !line.includes('--from='))
      .map((line) => line.split(/\s+/)[1]);
    assert.ok(copies.length > 0, `${dockerfile} copies files from the context`);
    for (const source of copies) {
      assert.equal(isIgnored(patterns, source.replace(/\/$/, '')), false, `${dockerfile}: ${source} must not be excluded by .dockerignore`);
      assert.doesNotMatch(source, /^apps\/web-console\/dist/, `${dockerfile} must not copy the legacy dist`);
    }
  }
});

test('the context model rejects the previous .dockerignore, which dropped the next dist', () => {
  const previous = ['**/dist', '!apps/web-console/dist', '!apps/web-console/dist/**'].map(compilePattern);
  assert.equal(isIgnored(previous, 'apps/web-console-next/dist/index.html'), true);
  assert.equal(isIgnored(previous, 'apps/web-console/dist/index.html'), false);
});
