import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { verify } from './reference-verifier.mjs';

const load = (relative) => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const REQUIRED_CASES = {
  "v1-invalid.json": [
    "missing-max-lifetime",
    "missing-exp",
    "guest-holder",
    "wrong-issuer",
    "foreign-audience",
    "now-equals-exp",
    "tenant-only-mismatch",
    "workspace-only-mismatch",
    "attempt-mismatch",
    "completed-attempt",
    "capabilities-outside-pinned-grants",
    "requested-capability-absent",
    "guest-tenant-mismatch",
    "dotted-jwt-like-handle",
    "unknown-handle",
    "handle-of-another-attempt",
    "tenant-container-holder",
    "zero-max-lifetime",
    "negative-max-lifetime",
    "string-infinity-max-lifetime",
    "now-after-exp",
    "iat-after-now",
    "exp-equals-deadline-plus-one",
    "lifetime-equals-max-plus-one",
    "activation-mismatch",
    "revision-mismatch",
    "pool_profile-mismatch",
    "cancelled-attempt",
    "guest-workspace-mismatch",
    "extra-claims-property",
    "extra-nested-claims-property",
    "handle-after-completed",
    "handle-after-cancelled",
    "handle-after-expired",
    "pem-marker-handle",
    "whitespace-handle",
    "embedded-claims-handle",
    "empty-handle",
    "unknown-context-property",
    "unknown-guest-property",
    "non-number-now",
    "empty-allowed-capabilities",
    "duplicate-registry-handle",
    "trailing-newline-handle"
  ],
  "v1-valid.json": [
    "valid-wasm-host-binding",
    "valid-oci-shim",
    "now-equals-iat",
    "now-equals-exp-minus-one",
    "matching-guest-scope",
    "canonical-grant-key-order"
  ]
};
const files = fs.readdirSync(new URL('./fixtures/', import.meta.url)).filter((file) => file.endsWith('.json')).sort();
const byFile = Object.fromEntries(files.map((file) => [file, load(`./fixtures/${file}`)]));
const fixtures = Object.values(byFile).flat();
const base = fixtures.find((fixture) => fixture.name === 'valid-wasm-host-binding');
const reject = (reason) => ({ verdict: 'reject', reason });
const REASONS = [
  'invalid-lifetime-config', 'malformed-claims', 'untrusted-holder', 'wrong-issuer', 'wrong-audience',
  'expired-or-overlong', 'tenant-mismatch', 'workspace-mismatch', 'scope-mismatch', 'attempt-not-active',
  'capabilities-outside-grants', 'requested-capability-not-allowed', 'guest-scope-mismatch',
  'malformed-handle', 'unknown-handle', 'handle-not-bound-to-attempt',
];

test('execution-credential v1: fixture and declared reason coverage', () => {
  assert.deepEqual(files, Object.keys(REQUIRED_CASES).sort());
  assert.equal(new Set(fixtures.map((fixture) => fixture.name)).size, fixtures.length, 'unique fixture names');
  const readme = fs.readFileSync(new URL('./README.md', import.meta.url), 'utf8');
  const reasonSection = readme.split('## Rejection reason codes\n')[1].split('\n## ')[0];
  const declared = [...reasonSection.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(declared, REASONS, 'README declares exactly the stable v1 reason codes');
  for (const fixture of fixtures) {
    assert.ok(['accept', 'reject'].includes(fixture.expected.verdict), fixture.name);
    if (fixture.expected.verdict === 'accept') assert.equal(fixture.expected.reason, null, fixture.name);
    else assert.ok(REASONS.includes(fixture.expected.reason), `${fixture.name}: undeclared code`);
  }
  assert.deepEqual(
    [...new Set(fixtures.filter((fixture) => fixture.expected.verdict === 'reject').map((fixture) => fixture.expected.reason))].sort(),
    [...REASONS].sort(),
    'every declared reason needs a rejecting fixture',
  );
  for (const [file, names] of Object.entries(REQUIRED_CASES)) {
    assert.deepEqual(byFile[file].map((fixture) => fixture.name), names, `${file}: every contracted fixture is required`);
  }
});

for (const [file, cases] of Object.entries(byFile)) {
  test(`execution-credential v1: ${file}`, async (t) => {
    for (const fixture of cases) {
      await t.test(fixture.name, () => {
        assert.deepEqual(verify(fixture.claims, fixture.context), fixture.expected);
      });
    }
  });
}

test('execution-credential v1: claims and every pinned grant reuse the existing v1 schema by path', async (t) => {
  const grantSchema = load('../capability-grants/capability-grants.v1.schema.json');
  const claimsSchema = load('./execution-credential.v1.claims.schema.json');
  assert.equal(claimsSchema.properties.allowed_capabilities.items.$ref, `${grantSchema.$id}#/$defs/grant`);
  assert.equal(claimsSchema.$defs, undefined, 'grant definitions must not be copied');
  assert.equal(claimsSchema.additionalProperties, false);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validGrants = ajv.compile(grantSchema);
  ajv.compile(claimsSchema);
  for (const fixture of fixtures) {
    await t.test(fixture.name, () => {
      assert.equal(validGrants(fixture.context.pinned_grants), true, JSON.stringify(validGrants.errors));
    });
  }
});

test('execution-credential v1: non-finite claim times are malformed', async (t) => {
  for (const key of ['iat', 'exp']) {
    for (const value of [NaN, Infinity, -Infinity]) {
      await t.test(`${key}=${value}`, () => {
        assert.deepEqual(verify({ ...base.claims, [key]: value }, base.context), reject('malformed-claims'));
      });
    }
  }
});

test('execution-credential v1: unknown inputs and exceptions fail closed', async (t) => {
  const cases = [
    ['missing-inputs', () => verify(), 'invalid-lifetime-config'],
    ['null-context', () => verify(base.claims, null), 'invalid-lifetime-config'],
    ['null-claims', () => verify(null, base.context), 'malformed-claims'],
    ['unknown-claims', () => verify('unknown', base.context), 'malformed-claims'],
    ['malformed-pinned-grants', () => verify(base.claims, { ...base.context, pinned_grants: [{ family: 'unknown' }] }), 'capabilities-outside-grants'],
    ['missing-request', () => {
      const context = structuredClone(base.context);
      delete context.requested_capability;
      return verify(base.claims, context);
    }, 'requested-capability-not-allowed'],
    ['unknown-attempt-state', () => verify(base.claims, { ...base.context, attempt_state: 'unknown' }), 'attempt-not-active'],
    ['missing-registry', () => verify(base.claims, { ...base.context, handle_registry: undefined }), 'malformed-handle'],
    ['thrown-context-access', () => verify(base.claims, new Proxy({}, { get() { throw new Error('test-only'); } })), 'malformed-claims'],
  ];
  for (const [name, run, reason] of cases) {
    await t.test(name, () => assert.deepEqual(run(), reject(reason)));
  }
  for (const value of [NaN, Infinity, -Infinity, null, '60']) {
    await t.test(`invalid maximum ${value}`, () => {
      assert.deepEqual(verify(base.claims, { ...base.context, max_lifetime_seconds: value }), reject('invalid-lifetime-config'));
    });
  }
});

test('execution-credential v1: matching guest scope never rescues an otherwise rejecting credential', async (t) => {
  for (const fixture of fixtures.filter((fixture) => fixture.expected.verdict === 'reject' && fixture.expected.reason !== 'guest-scope-mismatch')) {
    await t.test(fixture.name, () => {
      const guest_scope = { tenant: fixture.claims.tenant, workspace: fixture.claims.workspace };
      assert.deepEqual(verify(fixture.claims, { ...fixture.context, guest_scope }), fixture.expected);
    });
  }
});

test('execution-credential v1: first failing check wins in documented order', async (t) => {
  const checks = [
    ['invalid-lifetime-config', (f) => { delete f.context.max_lifetime_seconds; }],
    ['malformed-claims', (f) => { delete f.claims.exp; }],
    ['untrusted-holder', (f) => { f.context.holder = 'guest'; }],
    ['wrong-issuer', (f) => { f.claims.iss = 'foreign:issuer'; }],
    ['wrong-audience', (f) => { f.claims.aud = 'foreign:host'; }],
    ['expired-or-overlong', (f) => { f.context.now = 1060; }],
    ['tenant-mismatch', (f) => { f.claims.tenant = 'tenant-b'; }],
    ['workspace-mismatch', (f) => { f.claims.workspace = 'workspace-b'; }],
    ['scope-mismatch', (f) => { f.claims.attempt = 'attempt-b'; }],
    ['attempt-not-active', (f) => { f.context.attempt_state = 'completed'; }],
    ['capabilities-outside-grants', (f) => { f.context.pinned_grants[0].scope.prefixes = ['other/']; }],
    ['requested-capability-not-allowed', (f) => { f.context.requested_capability.scope.prefixes = ['other/']; }],
    ['guest-scope-mismatch', (f) => { f.context.guest_scope = { tenant: 'tenant-b' }; }],
    ['malformed-handle', (f) => { f.context.handle_registry[0].handle = 'test.claims.signature'; }],
    ['unknown-handle', (f) => { f.context.presented_handle = 'guessed_test_handle'; }],
    ['handle-not-bound-to-attempt', (f) => { f.context.handle_registry[0].state = 'expired'; }],
  ];
  for (let i = 0; i < checks.length - 1; i += 1) {
    const [reason, first] = checks[i];
    const [laterReason, second] = checks[i + 1];
    await t.test(`${reason} before ${laterReason}`, () => {
      const fixture = structuredClone(base);
      first(fixture);
      second(fixture);
      assert.deepEqual(verify(fixture.claims, fixture.context), reject(reason));
    });
  }
});

test('execution-credential v1: verification does not mutate caller inputs', () => {
  const fixture = structuredClone(base);
  assert.deepEqual(verify(fixture.claims, fixture.context), { verdict: 'accept', reason: null });
  assert.deepEqual(fixture, base);
});
