import { assembleSpec } from '../src/spec-assembler.mjs';

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

  const spec = JSON.parse(assembled.formatJson);
  if (spec.openapi !== '3.1.0' || !spec.info?.version || !spec.servers?.[0]?.url || typeof spec.paths !== 'object') {
    console.error('OpenAPI lint failed for capability set:', [...enabled].join(',') || '(empty)');
    process.exit(1);
  }
}

console.log('OpenAPI lint passed');
