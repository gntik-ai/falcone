// Unit tests for the per-tenant MCP server registry + supply-chain controls
// (change add-mcp-registry-supply-chain, #396).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRegistry, registerVersion, getServer, listVersions,
  diffVersions, activateVersion, rollbackToVersion, verifyImageForDeploy,
} from './mcp-registry.mjs';

const DIGEST_A = 'registry.example.com/acme/mcp@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DIGEST_B = 'registry.example.com/acme/mcp@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const manifest = (tools) => ({ status: 'published', tools });

test('registerVersion: refuses an image that is not digest-pinned (rug-pull guard)', () => {
  const reg = createRegistry();
  const r = registerVersion(reg, { tenantId: 't1', serverId: 's1', version: 'v1', image: 'registry.example.com/acme/mcp:1.0.0', manifest: manifest([]) });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.code === 'version_not_digest_pinned'));
  assert.equal(listVersions(reg, 't1', 's1').length, 0);
});

test('registerVersion: digest-pinned version is recorded with its tools + digest', () => {
  const reg = createRegistry();
  const r = registerVersion(reg, { tenantId: 't1', serverId: 's1', version: 'v1', image: DIGEST_A, source: 'custom', signatureVerified: true, manifest: manifest([{ name: 'read_x', description: 'read', mutates: false }]) });
  assert.equal(r.ok, true);
  assert.equal(r.version.digest, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(r.version.source, 'custom');
  assert.equal(listVersions(reg, 't1', 's1').length, 1);
});

test('registry entries are tenant-scoped: a cross-tenant probe returns nothing', () => {
  const reg = createRegistry();
  registerVersion(reg, { tenantId: 'tenant-a', serverId: 's1', version: 'v1', image: DIGEST_A, manifest: manifest([]) });
  assert.ok(getServer(reg, 'tenant-a', 's1')); // owner sees it
  assert.equal(getServer(reg, 'tenant-b', 's1'), null); // other tenant cannot
  assert.deepEqual(listVersions(reg, 'tenant-b', 's1'), []);
});

test('diffVersions: detects added/removed tools and changed description/scope', () => {
  const prev = { tools: [{ name: 'a', description: 'old', scope: 's:a' }, { name: 'b', description: 'b', scope: 's:b' }] };
  const next = { tools: [{ name: 'a', description: 'NEW', scope: 's:a' }, { name: 'c', description: 'c', scope: 's:c' }] };
  const d = diffVersions(prev, next);
  assert.deepEqual(d.added, ['c']);
  assert.deepEqual(d.removed, ['b']);
  assert.deepEqual(d.changed, [{ tool: 'a', fields: ['description'] }]);
  assert.equal(d.requiresReview, true);
});

test('diffVersions: identical tool contract needs no review', () => {
  const v = { tools: [{ name: 'a', description: 'same', scope: 's:a' }] };
  assert.equal(diffVersions(v, { tools: [{ name: 'a', description: 'same', scope: 's:a' }] }).requiresReview, false);
});

test('review gate: a tool-changing bump cannot serve until approved, then serves', () => {
  const reg = createRegistry();
  registerVersion(reg, { tenantId: 't1', serverId: 's1', version: 'v1', image: DIGEST_A, signatureVerified: true, manifest: manifest([{ name: 'a', description: 'old', mutates: true, scope: 's:a' }]) });
  assert.equal(activateVersion(reg, 't1', 's1', 'v1').ok, true); // baseline activates

  // v2 changes a's description -> requiresReview
  const r2 = registerVersion(reg, { tenantId: 't1', serverId: 's1', version: 'v2', image: DIGEST_B, signatureVerified: true, manifest: manifest([{ name: 'a', description: 'CHANGED', mutates: true, scope: 's:a' }]) });
  assert.equal(r2.version.requiresReview, true);

  const blocked = activateVersion(reg, 't1', 's1', 'v2');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.violations.some((v) => v.code === 'review_required'));
  assert.equal(getServer(reg, 't1', 's1').activeVersion, 'v1'); // still on v1

  const approvedAct = activateVersion(reg, 't1', 's1', 'v2', { approved: true });
  assert.equal(approvedAct.ok, true);
  assert.equal(getServer(reg, 't1', 's1').activeVersion, 'v2');
});

test('rollbackToVersion: re-activates a previously approved version without re-review', () => {
  const reg = createRegistry();
  registerVersion(reg, { tenantId: 't1', serverId: 's1', version: 'v1', image: DIGEST_A, signatureVerified: true, manifest: manifest([{ name: 'a', description: 'old', mutates: true, scope: 's:a' }]) });
  activateVersion(reg, 't1', 's1', 'v1');
  registerVersion(reg, { tenantId: 't1', serverId: 's1', version: 'v2', image: DIGEST_B, signatureVerified: true, manifest: manifest([{ name: 'a', description: 'CHANGED', mutates: true, scope: 's:a' }]) });
  activateVersion(reg, 't1', 's1', 'v2', { approved: true });

  const back = rollbackToVersion(reg, 't1', 's1', 'v1');
  assert.equal(back.ok, true);
  assert.equal(getServer(reg, 't1', 's1').activeVersion, 'v1');
  assert.equal(getServer(reg, 't1', 's1').versions.find((v) => v.version === 'v1').active, true);
});

test('verifyImageForDeploy: rejects unsigned, unpinned, and disallowed-registry images', () => {
  const allow = ['registry.example.com'];
  // unsigned
  assert.equal(verifyImageForDeploy({ image: DIGEST_A, signatureVerified: false, allowedRegistries: allow }).ok, false);
  // unpinned (latest)
  const unpinned = verifyImageForDeploy({ image: 'registry.example.com/acme/mcp:latest', signatureVerified: true, allowedRegistries: allow });
  assert.equal(unpinned.ok, false);
  assert.ok(unpinned.violations.some((v) => v.code === 'image_not_pinned'));
  // disallowed registry
  const badReg = verifyImageForDeploy({ image: 'evil.io/acme/mcp@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', signatureVerified: true, allowedRegistries: allow });
  assert.equal(badReg.ok, false);
  assert.ok(badReg.violations.some((v) => v.code === 'registry_not_allowed'));
});

test('verifyImageForDeploy: accepts a signed, digest-pinned, allow-listed image', () => {
  const ok = verifyImageForDeploy({ image: DIGEST_A, signatureVerified: true, allowedRegistries: ['registry.example.com'] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.violations, []);
});
