import { collectObservabilityDashboardViolations } from './lib/observability-dashboards.mjs';

const violations = collectObservabilityDashboardViolations();

if (violations.length > 0) {
  console.error('Observability dashboards validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Observability dashboards validation passed.');
}
