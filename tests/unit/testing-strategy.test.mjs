import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectTestingStrategyViolations,
  readReferenceDataset,
  readTestingStrategy
} from '../../scripts/lib/testing-strategy.mjs';
import { OPENAPI_PATH, readJson, resolveParameters } from '../../scripts/lib/quality-gates.mjs';

test('testing strategy package remains internally consistent', () => {
  const violations = collectTestingStrategyViolations(
    readTestingStrategy(),
    readReferenceDataset(),
    readJson(OPENAPI_PATH)
  );

  assert.deepEqual(violations, []);
});

test('testing strategy accepts optional version and correlation headers for both EventSource GET streams', () => {
  const document = readJson(OPENAPI_PATH);
  for (const path of [
    '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes',
    '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes',
  ]) {
    const operation = document.paths[path].get;
    for (const name of ['X-API-Version', 'X-Correlation-Id']) {
      assert.equal(operation.parameters.find(parameter => parameter.name === name)?.required, false);
    }
  }
  assert.deepEqual(collectTestingStrategyViolations(
    readTestingStrategy(), readReferenceDataset(), document
  ), []);
});

test('testing strategy keeps required headers outside the exact GET stream family and paths', () => {
  const streamPath = '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes';
  for (const [path, method, family] of [
    [`${streamPath}-other`, 'get', 'realtime-changes'],
    [streamPath, 'post', 'realtime-changes'],
    [streamPath, 'get', 'mongo-captures'],
  ]) {
    const document = readJson(OPENAPI_PATH);
    const operation = structuredClone(document.paths[streamPath].get);
    operation['x-family'] = family;
    document.paths[path] = { [method]: operation };
    const violations = collectTestingStrategyViolations(
      readTestingStrategy(), readReferenceDataset(), document
    );
    assert.ok(violations.includes(`${method.toUpperCase()} ${path} in OpenAPI must require X-API-Version.`));
    // With a valid version header, correlation requirements must still apply.
    operation.parameters.find(parameter => parameter.name === 'X-API-Version').required = true;
    assert.ok(collectTestingStrategyViolations(
      readTestingStrategy(), readReferenceDataset(), document
    ).includes(`${method.toUpperCase()} ${path} in OpenAPI must require X-Correlation-Id.`));
  }
});

test('testing strategy keeps required headers on capture management operations', () => {
  const path = '/v1/realtime/workspaces/{workspaceId}/mongo-captures';
  for (const name of ['X-API-Version', 'X-Correlation-Id']) {
    const document = readJson(OPENAPI_PATH);
    const operation = document.paths[path].get;
    operation.parameters = structuredClone(resolveParameters(document, operation));
    operation.parameters.find(parameter => parameter.name === name).required = false;
    assert.ok(collectTestingStrategyViolations(
      readTestingStrategy(), readReferenceDataset(), document
    ).includes(`GET ${path} in OpenAPI must require ${name}.`));
  }
});

test('testing strategy still validates the pinned version on an optional stream header', () => {
  const path = '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes';
  const document = readJson(OPENAPI_PATH);
  const header = document.paths[path].get.parameters.find(parameter => parameter.name === 'X-API-Version');
  header.schema = { type: 'string', const: '1999-01-01' };
  assert.ok(collectTestingStrategyViolations(
    readTestingStrategy(), readReferenceDataset(), document
  ).includes(`GET ${path} in OpenAPI requires 1999-01-01 but strategy expects 2026-03-26.`));
});

test('testing strategy still requires stream headers to be documented', () => {
  const path = '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes';
  for (const name of ['X-API-Version', 'X-Correlation-Id']) {
    const document = readJson(OPENAPI_PATH);
    const operation = document.paths[path].get;
    operation.parameters = operation.parameters.filter(parameter => parameter.name !== name);
    assert.ok(collectTestingStrategyViolations(
      readTestingStrategy(), readReferenceDataset(), document
    ).includes(`GET ${path} in OpenAPI must require ${name}.`));
  }
});

test('collectTestingStrategyViolations flags missing layers, fixtures, and console states', () => {
  const strategy = {
    pyramid: [{ level: 'unit', purpose: '', why_now: '' }],
    cross_domain_matrix: {
      domains: [{ id: 'console' }],
      scenarios: [
        {
          id: 'bad-id',
          level: 'unit',
          domain: 'console',
          taxonomy: 'positive',
          fixtures: ['missing-fixture']
        }
      ]
    },
    scenario_taxonomy: {
      categories: [{ id: 'positive' }]
    },
    console: {
      states: [{ id: 'unauthenticated', visible_sections: [], blocked_sections: [], allowed_actions: [] }]
    },
    api_contract: {
      uri_prefix: '/v2/',
      version_header: { name: 'X-Other-Version', current_value: '' },
      required_error_contracts: true
    }
  };

  const dataset = {
    tenants: [],
    users: [],
    workspaces: [],
    adapters: [],
    api_versions: [],
    events: [],
    resilience_cases: [],
    console_routes: []
  };

  const violations = collectTestingStrategyViolations(strategy, dataset, {
    openapi: '3.1.0',
    info: { version: '0.1.0' },
    paths: {
      '/v1/example': {
        get: {
          operationId: 'getExample',
          parameters: [],
          responses: {
            '200': { description: 'ok' }
          }
        }
      }
    }
  });

  assert.ok(violations.some((violation) => violation.includes('missing level adapter_integration')));
  assert.ok(violations.some((violation) => violation.includes('Scenario id bad-id')));
  assert.ok(violations.some((violation) => violation.includes('unknown fixture missing-fixture')));
  assert.ok(violations.some((violation) => violation.includes('console states are missing platform_admin')));
  assert.ok(violations.some((violation) => violation.includes('uri_prefix must be /v1/')));
});
