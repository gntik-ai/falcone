import { collectAuditEventSchemaViolations } from './lib/observability-audit-event-schema.mjs';

const violations = collectAuditEventSchemaViolations();

if (violations.length > 0) {
  console.error('Observability audit event schema validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Observability audit event schema validation passed.');
}
