import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Docker .dockerignore semantics: patterns are evaluated in order, the last one that matches the path or one of
// its parent directories decides, and a leading "!" re-includes.
function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { source += '(?:.*/)?'; index += 2; } else { source += '.*'; index += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function isInBuildContext(dockerignore, path) {
  const rules = dockerignore.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    .map((line) => ({ negated: line.startsWith('!'), pattern: globToRegExp(line.replace(/^!/, '').replace(/\/$/, '')) }));
  const parts = path.split('/');
  const candidates = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  let excluded = false;
  for (const rule of rules) if (candidates.some((candidate) => rule.pattern.test(candidate))) excluded = rule.negated ? false : true;
  return !excluded;
}

const dockerignore = readFileSync(resolve(repoRoot, '.dockerignore'), 'utf8');

test('the docker build context contains the next dist so the kind image can copy it', () => {
  assert.equal(isInBuildContext(dockerignore, 'apps/web-console-next/dist/index.html'), true);
  assert.equal(isInBuildContext(dockerignore, 'apps/web-console-next/dist/assets/app.abc123.js'), true);
  const kind = readFileSync(resolve(repoRoot, 'deploy/kind/web-console/Dockerfile'), 'utf8');
  assert.match(kind, /^COPY apps\/web-console-next\/dist\/ \.\/dist\/$/m);
});

test('the docker build context never carries the legacy dist or node_modules', () => {
  assert.equal(isInBuildContext(dockerignore, 'apps/web-console/dist/index.html'), false);
  assert.equal(isInBuildContext(dockerignore, 'apps/web-console-next/node_modules/react/index.js'), false);
});

test('the context check is sensitive to the pre-cutover .dockerignore, which excluded the next dist', () => {
  // The relevant rules of the pre-cutover file: every dist excluded, only the legacy dist re-included.
  const before = '**/dist\n!apps/web-console/dist\n!apps/web-console/dist/**\n';
  assert.equal(isInBuildContext(before, 'apps/web-console-next/dist/index.html'), false);
  assert.equal(isInBuildContext(before, 'apps/web-console/dist/index.html'), true);
});
