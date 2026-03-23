import { collectTestingStrategyViolations, readReferenceDataset, readTestingStrategy } from './lib/testing-strategy.mjs';

const strategy = readTestingStrategy();
const dataset = readReferenceDataset();
const violations = collectTestingStrategyViolations(strategy, dataset);

if (violations.length > 0) {
  console.error('Testing strategy package validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Testing strategy package is internally consistent and aligned with the current contract.');
