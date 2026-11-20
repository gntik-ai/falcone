import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  escapeForLog, integrityFromLock, main, readTarEntry, sampleStringsFromFixture, verifyIntegrity
} from '../../apps/web-console-next/scripts/extract-kit-sample-strings.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const app = join(repoRoot, 'apps/web-console-next');
const committed = () => JSON.parse(readFileSync(join(app, 'tests/parity/kit-sample-strings.json'), 'utf8'));

// A one-file npm tarball: ustar header (name, octal size) + padded body + end-of-archive blocks, gzipped.
function tarball(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 'utf8');
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
const integrityOf = (buffer) => `sha512-${createHash('sha512').update(buffer).digest('base64')}`;

const FIXTURE = `
import { StatusTag } from '@gntik-ai/ui';
import { createElement } from 'react';
const NAMES = ['alpha-svc', 'beta-svc', 'gamma-svc'];
const REGIONS = ['mars-1', 'venus-2'];
export function generate(count) {
  return Array.from({ length: count }, (_, i) => ({ name: NAMES[i % 3] + (i >= 3 ? '-staging' : ''), region: REGIONS[i % 2] }));
}
export const DEPLOYMENT_ROWS = generate(4);
`;

test('the committed sample strings describe the pinned kit exactly as the lockfile records it', () => {
  const { kit, strings } = committed();
  const pin = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).dependencies['@gntik-ai/blocks'];
  assert.equal(kit.package, '@gntik-ai/blocks');
  assert.equal(kit.version, pin);
  assert.equal(kit.integrity, integrityFromLock(readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8'), '@gntik-ai/blocks', pin));
  assert.match(kit.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(strings, [...new Set(strings)].sort(), 'strings are unique and sorted');
  // Independent expectations from the kit's published sample deployments.
  for (const expected of ['orders-api', 'billing-sync-staging', 'eu-west-1', 'webhooks']) assert.ok(strings.includes(expected), expected);
  assert.equal(strings.length, 28);
});

test('the committed file is byte-identical to the strings extracted from the installed pinned kit', { skip: existsSync(join(app, 'node_modules/@gntik-ai/blocks')) ? false : 'the kit is not installed' }, async () => {
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(await main(['--check', '--package-dir', join(app, 'node_modules/@gntik-ai/blocks')]), 0);
  } finally {
    console.log = log;
  }
});

test('the extractor reads the kit fixture by running it, and rejects an unexpected import', () => {
  assert.deepEqual(sampleStringsFromFixture(FIXTURE), ['alpha-svc', 'alpha-svc-staging', 'beta-svc', 'gamma-svc', 'mars-1', 'venus-2']);
  assert.throws(() => sampleStringsFromFixture("import fs from 'node:fs';\nexport const DEPLOYMENT_ROWS = [fs.readFileSync('/etc/passwd', 'utf8')];"), /unexpected import/);
  assert.throws(() => sampleStringsFromFixture('export const OTHER = [];'), /no DEPLOYMENT_ROWS/);
  assert.throws(() => sampleStringsFromFixture('export const DEPLOYMENT_ROWS = [{ name: "a" }];'), /no region/);
});

test('the lockfile integrity is parsed for the exact package version only', () => {
  const lock = [
    "  '@gntik-ai/blocks@0.14.0':", '    resolution: {integrity: sha512-OLD==}', "  '@gntik-ai/blocks@0.15.0':",
    '    resolution: {integrity: sha512-NEW+/=}', '    peerDependencies:'
  ].join('\n');
  assert.equal(integrityFromLock(lock, '@gntik-ai/blocks', '0.15.0'), 'sha512-NEW+/=');
  assert.throws(() => integrityFromLock(lock, '@gntik-ai/blocks', '0.16.0'), /not in pnpm-lock/);
  assert.throws(() => integrityFromLock("  '@gntik-ai/blocks@0.15.0':\n    peerDependencies:\n", '@gntik-ai/blocks', '0.15.0'), /no integrity/);
});

test('tarball integrity is verified before anything is read from it', () => {
  const archive = tarball({ 'package/src/tables/DataTable/fixtures.ts': FIXTURE });
  verifyIntegrity(archive, integrityOf(archive));
  assert.throws(() => verifyIntegrity(archive, integrityOf(Buffer.from('another tarball'))), /integrity mismatch/);
  assert.equal(readTarEntry(archive, 'package/src/tables/DataTable/fixtures.ts'), FIXTURE);
  assert.throws(() => readTarEntry(archive, 'package/missing.ts'), /not in the tarball/);
});

test('main regenerates from a tarball whose integrity matches the lockfile, and fails on any other tarball', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kit-sample-'));
  try {
    const wrong = join(directory, 'wrong.tgz');
    writeFileSync(wrong, tarball({ 'package/src/tables/DataTable/fixtures.ts': FIXTURE }));
    await assert.rejects(main(['--check', '--tarball', wrong]), /integrity mismatch/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('log escaping replaces every backslash and quote, not just the first', () => {
  assert.equal(escapeForLog('a\\b\\c"d"e'), 'a\\\\b\\\\c\\"d\\"e');
  assert.equal(escapeForLog('\\"'), '\\\\\\"');
});
