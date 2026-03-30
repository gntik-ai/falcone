import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import spectralCore from '@stoplight/spectral-core';
import spectralRulesets from '@stoplight/spectral-rulesets';
const { Spectral } = spectralCore;
const { oas } = spectralRulesets;
import { assembleSpec } from '../src/spec-assembler.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceRoot = resolve(__dirname, '..');
const rulesetPath = resolve(serviceRoot, '.spectral.yaml');
await readFile(rulesetPath, 'utf8');

const spectral = new Spectral();
spectral.setRuleset(oas);

const combinations = [
  new Set(),
  new Set(['authentication', 'storage']),
  new Set(['authentication', 'storage', 'functions', 'realtime', 'mongodb', 'postgresql', 'events'])
];

for (const enabled of combinations) {
  const assembled = assembleSpec({
    enabledCapabilities: enabled,
    workspaceBaseUrl: 'https://api.example.test/v1/workspaces/ws_demo',
    previousSpecVersion: '1.0.0',
    previousCapabilityTags: []
  });

  const results = await spectral.run(JSON.parse(assembled.formatJson));
  const errors = results.filter((result) => result.severity === 0);
  if (errors.length > 0) {
    console.error('OpenAPI lint failed for capability set:', [...enabled].join(',') || '(empty)');
    for (const result of errors) {
      console.error(`- [${result.severity}] ${result.path.join('.')}: ${result.message}`);
    }
    process.exit(1);
  }
}

console.log('OpenAPI lint passed');
