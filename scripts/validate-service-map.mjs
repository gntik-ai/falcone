import { collectServiceMapViolations, readServiceMap } from './lib/service-map.mjs';

const serviceMap = readServiceMap();
const violations = collectServiceMapViolations(serviceMap);

if (violations.length > 0) {
  console.error('Internal service-map validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Internal service map and contract scaffolding are present and internally consistent.');
