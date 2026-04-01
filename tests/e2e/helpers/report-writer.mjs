/**
 * Report writer for the restore E2E suite.
 * Validates reports against the JSON Schema contract using Ajv.
 * @module tests/e2e/helpers/report-writer
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../../../specs/119-sandbox-restore-functional-tests/contracts/restore-test-report.json');
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(SCHEMA);

/**
 * Write the report to JSON and companion text summary after schema validation.
 *
 * @param {object} report
 * @param {string} outputPath
 */
export function writeReport(report, outputPath) {
  if (!validate(report)) {
    const details = ajv.errorsText(validate.errors, { separator: '\n' });
    throw new Error(`Report validation failed against ${SCHEMA_PATH}:\n${details}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

  const lines = [
    `Restore E2E Report: ${report.execution_id}`,
    `Started: ${report.started_at}`,
    `Finished: ${report.finished_at}`,
    `Duration: ${report.duration_ms} ms`,
    `Summary: total=${report.summary.total}, passed=${report.summary.passed}, failed=${report.summary.failed}, skipped=${report.summary.skipped}`,
    '',
  ];

  for (const scenario of report.scenarios ?? []) {
    lines.push(
      `[${scenario.scenario_id}] ${scenario.name} — ${scenario.status} (${scenario.duration_ms} ms)`,
    );
    if (scenario.skip_reason) lines.push(`  skip: ${scenario.skip_reason}`);
    if (scenario.failure_detail?.message) lines.push(`  fail: ${scenario.failure_detail.message}`);
  }

  writeFileSync(`${outputPath}.txt`, `${lines.join('\n')}\n`, 'utf8');
}
