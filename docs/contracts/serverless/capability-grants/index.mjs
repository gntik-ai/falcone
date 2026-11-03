import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(DIR, 'fixtures');
const VENDORED = 'vendored-from-revision-runtime-manifest.json';

const jsonFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f));
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
};

// The vendored definitions are used verbatim, so Ajv strict mode (pattern without type) is relaxed here, not in the schema.
const compile = (schemaFile) => new Ajv2020({ allErrors: true, strict: false }).compile(load(path.join(DIR, schemaFile)));
const errorsOf = (validate, data) => (validate(data) ? [] : validate.errors);
const hasError = (errors, want) => errors.some((e) => e.keyword === want.keyword
  && e.instancePath === want.path
  && (want.params === undefined || Object.entries(want.params).every(([k, v]) => e.params[k] === v)));

const REQUIRED_CASES = {
  'v1-valid.json': ['storage', 'http', 'event', 'workflow'],
  'v1-invalid.json': ['bare-star-scope', 'empty-list', 'unknown-family', 'unknown-property'],
  'v1.1-valid.json': ['secret-host-use', 'secret-guest-exposed-reviewed', 'internal-destination-binding'],
  'v1.1-invalid.json': [
    'no-exposure', 'no-review', 'review-no-reviewer', 'review-no-scope', 'no-operation', 'empty-purpose', 'bad-date',
    'inline-value', 'dest-extra-prop', 'dest-no-port', 'port-0', 'port-65536', 'scheme-http',
    'host-169.254.169.254', 'host-10.0.0.1', 'host-fe80::1', 'host-fd00:ec2::254', 'host-metadata.google.internal',
    'host-*.internal', 'host-10.0.0.0/8',
  ],
};

// The keyword and location each invalid case must fail on, so a case cannot be rejected for the wrong reason.
const SG = '/0/secret_grant';
const IB = '/0/internal_destination_binding';
const hostPattern = { keyword: 'pattern', path: `${IB}/host` };
const EXPECTED = {
  'v1-invalid.json': {
    'bare-star-scope': { keyword: 'not', path: '/0/scope/prefixes/0' },
    'empty-list': { keyword: 'minItems', path: '/0/scope/prefixes' },
    'unknown-family': { keyword: 'enum', path: '/0/family' },
    'unknown-property': { keyword: 'additionalProperties', path: '/0', params: { additionalProperty: 'extra' } },
  },
  'v1.1-invalid.json': {
    'no-exposure': { keyword: 'required', path: SG, params: { missingProperty: 'exposure' } },
    'no-review': { keyword: 'required', path: SG, params: { missingProperty: 'review' } },
    'review-no-reviewer': { keyword: 'required', path: `${SG}/review`, params: { missingProperty: 'reviewer' } },
    'review-no-scope': { keyword: 'required', path: `${SG}/review`, params: { missingProperty: 'scope' } },
    'no-operation': { keyword: 'required', path: SG, params: { missingProperty: 'host_operation' } },
    'empty-purpose': { keyword: 'minLength', path: `${SG}/purpose` },
    'bad-date': { keyword: 'pattern', path: `${SG}/review/reviewed_at` },
    'inline-value': { keyword: 'additionalProperties', path: SG, params: { additionalProperty: 'value' } },
    'dest-extra-prop': { keyword: 'additionalProperties', path: IB, params: { additionalProperty: 'path' } },
    'dest-no-port': { keyword: 'required', path: IB, params: { missingProperty: 'port' } },
    'port-0': { keyword: 'minimum', path: `${IB}/port` },
    'port-65536': { keyword: 'maximum', path: `${IB}/port` },
    'scheme-http': { keyword: 'enum', path: `${IB}/scheme` },
    'host-169.254.169.254': hostPattern,
    'host-10.0.0.1': hostPattern,
    'host-fe80::1': hostPattern,
    'host-fd00:ec2::254': hostPattern,
    'host-metadata.google.internal': { keyword: 'not', path: `${IB}/host` },
    'host-*.internal': hostPattern,
    'host-10.0.0.0/8': hostPattern,
  },
};

test('capability-grants: every JSON file under the contract directory parses and every schema compiles', async (t) => {
  const files = [...jsonFiles(DIR), ...jsonFiles(FIXTURES)];
  assert.ok(files.length >= 7, `expected at least 7 JSON files, found ${files.length}`);
  for (const file of files) {
    await t.test(path.relative(DIR, file), () => {
      load(file);
    });
  }
  for (const file of jsonFiles(DIR).filter((f) => f.endsWith('.schema.json'))) {
    await t.test(`compile ${path.basename(file)}`, () => {
      compile(path.basename(file));
    });
  }
});

test('capability-grants: v1 and v1.1 definitions are pinned to the vendored revision-runtime-manifest block', async (t) => {
  const vendored = load(path.join(DIR, VENDORED));
  const v1 = load(path.join(DIR, 'capability-grants.v1.schema.json')).$defs;
  const v11 = load(path.join(DIR, 'capability-grants.v1.1.schema.json')).$defs;
  assert.deepEqual(Object.keys(v1).sort(), Object.keys(vendored).sort(), 'v1 $defs must be exactly the vendored set');
  for (const name of Object.keys(vendored)) {
    await t.test(`v1 $defs.${name}`, () => assert.equal(canonical(v1[name]), canonical(vendored[name])));
    await t.test(`v1.1 $defs.${name}`, () => assert.equal(canonical(v11[name]), canonical(vendored[name])));
  }
  await t.test('v1.1 only adds review, secret_grant and internal_destination_binding', () => {
    const added = Object.keys(v11).filter((k) => !(k in vendored)).sort();
    assert.deepEqual(added, ['internal_destination_binding', 'review', 'secret_grant']);
  });
});

for (const [file, names] of Object.entries(REQUIRED_CASES)) {
  const version = file.startsWith('v1.1') ? 'v1.1' : 'v1';
  const valid = file.endsWith('-valid.json');
  const validate = compile(`capability-grants.${version}.schema.json`);
  const cases = load(path.join(FIXTURES, file));

  test(`capability-grants ${version} ${valid ? 'valid' : 'invalid'} fixtures (${file})`, async (t) => {
    assert.deepEqual(cases.map((c) => c.name), names, `${file} must hold exactly the contracted cases`);
    for (const c of cases) {
      await t.test(c.name, () => {
        const errors = errorsOf(validate, c.data);
        if (valid) {
          assert.deepEqual(errors, [], `${c.name} must be accepted by ${version}`);
          return;
        }
        assert.notEqual(errors.length, 0, `${c.name} must be rejected by ${version}`);
        const want = EXPECTED[file][c.name];
        assert.ok(hasError(errors, want), `${c.name} must fail on ${JSON.stringify(want)}, got ${JSON.stringify(errors)}`);
      });
    }
  });
}

test('capability-grants: every v1 valid case is also accepted by v1.1', async (t) => {
  const validate = compile('capability-grants.v1.1.schema.json');
  for (const c of load(path.join(FIXTURES, 'v1-valid.json'))) {
    await t.test(c.name, () => assert.deepEqual(errorsOf(validate, c.data), []));
  }
});

test('capability-grants: v1 rejects the v1.1 additions (default-deny until a consumer opts in)', async (t) => {
  const validate = compile('capability-grants.v1.schema.json');
  for (const c of load(path.join(FIXTURES, 'v1.1-valid.json'))) {
    await t.test(c.name, () => assert.notEqual(errorsOf(validate, c.data).length, 0));
  }
});
