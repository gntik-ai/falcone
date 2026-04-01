/**
 * Correlation-id and execution-id utilities for E2E restore test suite.
 * @module tests/e2e/helpers/correlation
 */

import { randomUUID } from 'node:crypto';

const PREFIX = process.env.RESTORE_TEST_CORRELATION_PREFIX ?? 'restore-e2e';

/**
 * Generate a unique execution ID for this test run.
 * @returns {string} UUID
 */
export function generateExecutionId() {
  return randomUUID();
}

/**
 * Build a correlation ID scoped to a specific scenario within an execution.
 * @param {string} executionId
 * @param {string} scenarioName - e.g. 'E1', 'EC3'
 * @returns {string}
 */
export function buildCorrelationId(executionId, scenarioName) {
  return `${PREFIX}-${executionId}-${scenarioName}`;
}
