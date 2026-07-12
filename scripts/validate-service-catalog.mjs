import { collectServiceCatalogViolations, readServiceCatalog } from './lib/service-catalog.mjs';

const violations = collectServiceCatalogViolations(readServiceCatalog());

if (violations.length > 0) {
  console.error('Service catalog/layout validation failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Service catalog, release matrix, and repository layout are coherent.');
