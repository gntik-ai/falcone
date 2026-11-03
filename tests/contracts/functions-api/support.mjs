import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import YAML from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

// The single place that names the route-level inventory (Functions family contract, source-defined).
export const INVENTORY_PATH = 'apps/control-plane-executor/openapi/families/functions.openapi.json';
export const CONTRACT_PATH = 'docs/contracts/serverless/functions-api/openapi.v1.yaml';
export const FIXTURES_DIR = path.join(here, 'fixtures');

export const REQUIRED_FIXTURES = [
  'runtime-mode/omitted',
  'runtime-mode/wasm',
  'runtime-mode/oci',
  'runtime-mode/invalid-native',
  'base/catalog',
  'base/byo',
  'base/omitted',
  'base/invalid-kind-default',
  'base/invalid-catalog-no-digest',
  'base/invalid-byo-no-signer',
  'errors/oci_not_authorized',
  'errors/base_disabled',
  'errors/base_mismatch',
  'status/runtime-mode-wasm',
  'status/runtime-mode-oci',
  'status/failure-oci_not_authorized',
  'status/failure-base_disabled',
  'status/failure-base_mismatch',
  'status/invalid-unknown-reason',
];

// Operator decision 3 (2026-11-03): the exact catalog id pattern and its oracle values.
export const CATALOG_ID_PATTERN = '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?@(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const CATALOG_ID_VALID = {
  'node22-1.0.0': 'node22@1.0.0',
  'python-3-12-2.10.3': 'python-3-12@2.10.3',
  'go-1.0.0-rc.1': 'go@1.0.0-rc.1',
  'a-0.0.0': 'a@0.0.0',
};
export const CATALOG_ID_INVALID = {
  uppercase: 'Node22@1.0.0',
  'two-part-version': 'node22@1.0',
  'leading-zero': 'node22@01.0.0',
  'build-metadata': 'node22@1.0.0+build.5',
  'leading-hyphen': '-node@1.0.0',
  'no-version': 'node22',
  'alias-latest': 'node22@latest',
};

export const ERROR_REASONS = {
  oci_not_authorized: 'GW_OCI_NOT_AUTHORIZED',
  base_disabled: 'GW_BASE_DISABLED',
  base_mismatch: 'GW_BASE_MISMATCH',
};

export const CONFIGURATION_SCHEMAS = [
  'FunctionExecutionConfiguration',
  'FunctionActionExecutionConfiguration',
  'FunctionDefinitionPayload',
];

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function deepClone(value) {
  return structuredClone(value);
}

export function loadInventory(inventoryPath = INVENTORY_PATH) {
  const file = path.join(REPO_ROOT, inventoryPath);
  if (!fs.existsSync(file)) throw new Error(`inventory missing: ${inventoryPath}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`inventory unparseable: ${inventoryPath}: ${error.message}`);
  }
}

export function loadContract() {
  const file = path.join(REPO_ROOT, CONTRACT_PATH);
  if (!fs.existsSync(file)) throw new Error(`contract missing: ${CONTRACT_PATH}`);
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

export function fixturePath(name) {
  return path.join(FIXTURES_DIR, `${name}.json`);
}

// A fixture is present when its file exists, is non-empty and parses to a non-empty JSON object.
export function readFixture(name) {
  const file = fixturePath(name);
  if (!fs.existsSync(file)) throw new Error(`fixture missing: ${name}`);
  return parseFixture(name, fs.readFileSync(file, 'utf8'));
}

export function parseFixture(name, raw) {
  if (raw.trim() === '') throw new Error(`fixture empty: ${name}`);
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Object.keys(parsed).length === 0) throw new Error(`fixture empty: ${name}`);
  return parsed;
}

export function operationsOf(document) {
  const operations = [];
  for (const [route, item] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (item[method]) operations.push({ route, method, operationId: item[method].operationId, operation: item[method], pathItem: item });
    }
  }
  return operations;
}

export function decodePointer(pointer) {
  return pointer.replace(/^#/, '').split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function resolvePointer(document, pointer) {
  let node = document;
  for (const part of decodePointer(pointer)) {
    if (node === null || typeof node !== 'object' || !(part in node)) throw new Error(`unresolved $ref ${pointer}`);
    node = node[part];
  }
  return node;
}

export function resolveRef(document, node) {
  let current = node;
  const seen = new Set();
  while (current && typeof current === 'object' && typeof current.$ref === 'string') {
    if (seen.has(current.$ref)) throw new Error(`cyclic $ref ${current.$ref}`);
    seen.add(current.$ref);
    current = resolvePointer(document, current.$ref);
  }
  return current;
}

const FORMATS = {
  'date-time': /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  uri: /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/,
};

const validatorCache = new WeakMap();

// Compiles a schema node of `document` (components resolved from that same document) into a validator.
export function compileSchema(document, schema) {
  const key = JSON.stringify(schema);
  const cached = validatorCache.get(document)?.get(key);
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  ajv.addVocabulary(['components', 'discriminator', 'x-extensible-enum']);
  for (const [name, pattern] of Object.entries(FORMATS)) ajv.addFormat(name, pattern);
  const root = { $id: 'urn:functions-api:schema', components: document.components, allOf: [schema] };
  const validate = ajv.compile(root);
  if (!validatorCache.has(document)) validatorCache.set(document, new Map());
  validatorCache.get(document).set(key, validate);
  return validate;
}

export function schemaValidator(document, schemaName) {
  return compileSchema(document, { $ref: `#/components/schemas/${schemaName}` });
}

export function validatePointer(document, pointer, instance) {
  const validate = compileSchema(document, { $ref: pointer });
  return { valid: validate(instance), errors: validate.errors ?? [] };
}
