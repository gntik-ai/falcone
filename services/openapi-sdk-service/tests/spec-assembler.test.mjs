import test from 'node:test';
import assert from 'node:assert/strict';
import spectralCore from '@stoplight/spectral-core';
import spectralRulesets from '@stoplight/spectral-rulesets';
const { Spectral } = spectralCore;
const { oas } = spectralRulesets;
import { assembleSpec, computeNextVersion } from '../src/spec-assembler.mjs';

test('assembleSpec includes enabled capability paths and excludes disabled paths', () => {
  const assembled = assembleSpec({
    enabledCapabilities: new Set(['storage', 'authentication']),
    workspaceBaseUrl: 'https://api.example.test/v1/workspaces/ws_123',
    previousSpecVersion: '1.0.0',
    previousCapabilityTags: ['authentication']
  });
  const spec = JSON.parse(assembled.formatJson);
  assert.ok(spec.paths['/buckets']);
  assert.ok(spec.paths['/auth/tokens']);
  assert.equal(spec.paths['/channels'], undefined);
  assert.equal(spec.paths['/mongo/collections'], undefined);
});

test('assembleSpec with empty set produces valid empty paths object', () => {
  const assembled = assembleSpec({ enabledCapabilities: new Set(), workspaceBaseUrl: 'https://api.example.test', previousSpecVersion: '1.0.0', previousCapabilityTags: [] });
  const spec = JSON.parse(assembled.formatJson);
  assert.deepEqual(spec.paths, {});
});

test('computeNextVersion bumps semver according to capability delta', () => {
  assert.equal(computeNextVersion('1.2.3', ['storage'], ['storage', 'authentication']), '1.3.0');
  assert.equal(computeNextVersion('1.2.3', ['storage', 'authentication'], ['storage']), '2.0.0');
  assert.equal(computeNextVersion('1.2.3', ['storage'], ['storage']), '1.2.4');
});

test('contentHash format and server URL are correct', () => {
  const assembled = assembleSpec({ enabledCapabilities: new Set(['functions']), workspaceBaseUrl: 'https://api.example.test/w/ws', previousSpecVersion: '2.0.0', previousCapabilityTags: [] });
  const spec = JSON.parse(assembled.formatJson);
  assert.match(assembled.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(spec.servers[0].url, 'https://api.example.test/w/ws');
});

test('assembled spec passes spectral OAS lint', async () => {
  const spectral = new Spectral();
  spectral.setRuleset(oas);
  const assembled = assembleSpec({ enabledCapabilities: new Set(['storage', 'authentication']), workspaceBaseUrl: 'https://api.example.test', previousSpecVersion: '1.0.0', previousCapabilityTags: [] });
  const results = await spectral.run(JSON.parse(assembled.formatJson));
  assert.deepEqual(results.filter((result) => result.severity === 0), []);
});
