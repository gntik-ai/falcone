import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import SwaggerParser from '@apidevtools/swagger-parser';
import {
  CONTRACT_PATH, INVENTORY_PATH, REPO_ROOT, REQUIRED_FIXTURES,
  deepClone, loadContract, loadInventory, operationsOf, parseFixture, readFixture,
} from './support.mjs';
import { unresolvedRefs } from './parity.mjs';

// Semver with major exactly 1: 1.0.0 passes; 10.0.0 and 0.9.0 do not.
export function isV1Semver(version) {
  return typeof version === 'string'
    && /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/.test(version);
}

test('contract is valid OpenAPI 3.x and every $ref resolves', async () => {
  const contract = loadContract();
  assert.match(contract.openapi, /^3\./);
  assert.deepEqual(unresolvedRefs(contract), []);
  const validated = await SwaggerParser.validate(path.join(REPO_ROOT, CONTRACT_PATH));
  assert.match(validated.openapi, /^3\./);
});

test('info.version is semver with major 1', () => {
  assert.equal(isV1Semver(loadContract().info.version), true);
  assert.equal(loadContract().info.version, '1.0.0');
  assert.equal(isV1Semver('1.0.0'), true);
  assert.equal(isV1Semver('1.4.2'), true);
  assert.equal(isV1Semver('10.0.0'), false);
  assert.equal(isV1Semver('0.9.0'), false);
  assert.equal(isV1Semver('2.0.0'), false);
  assert.equal(isV1Semver('1.0'), false);
  assert.equal(isV1Semver(1), false);
});

test('mutated copies of the contract with a non-v1 version are rejected', () => {
  for (const version of ['10.0.0', '0.9.0']) {
    const copy = deepClone(loadContract());
    copy.info.version = version;
    assert.equal(isV1Semver(copy.info.version), false, version);
  }
});

test('the inventory path is readable and parseable, and fails closed otherwise', () => {
  assert.equal(INVENTORY_PATH, 'apps/control-plane-executor/openapi/families/functions.openapi.json');
  const inventory = loadInventory();
  assert.ok(operationsOf(inventory).length > 0);
  assert.ok(fs.statSync(path.join(REPO_ROOT, INVENTORY_PATH)).isFile());
});

test('a moved or unparseable inventory fails closed', () => {
  assert.throws(() => loadInventory('apps/control-plane-executor/openapi/families/functions.openapi.moved.json'), /inventory missing/);
  assert.throws(() => loadInventory('docs/contracts/serverless/functions-api/openapi.v1.yaml'), /inventory unparseable/);
});

test('every required fixture exists and is non-empty', () => {
  for (const name of REQUIRED_FIXTURES) assert.doesNotThrow(() => readFixture(name), name);
});

test('a missing or empty fixture is reported', () => {
  assert.throws(() => readFixture('runtime-mode/does-not-exist'), /fixture missing/);
  assert.throws(() => parseFixture('x', ''), /fixture empty/);
  assert.throws(() => parseFixture('x', '  \n'), /fixture empty/);
  assert.throws(() => parseFixture('x', '{}'), /fixture empty/);
  assert.throws(() => parseFixture('x', 'null'), /fixture empty/);
  assert.deepEqual(parseFixture('x', '{"a":1}'), { a: 1 });
});

test('fixtures/legacy has a non-empty file for every inventory operationId', () => {
  const inventory = loadInventory();
  const missing = [];
  for (const { operationId, method, route } of operationsOf(inventory)) {
    try {
      const fixture = readFixture(`legacy/${operationId}`);
      assert.equal(fixture.operationId, operationId);
      assert.equal(fixture.method, method);
      assert.equal(fixture.path, route);
    } catch (error) {
      missing.push(`${operationId}: ${error.message}`);
    }
  }
  assert.deepEqual(missing, []);
});
