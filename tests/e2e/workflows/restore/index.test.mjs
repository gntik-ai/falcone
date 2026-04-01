/**
 * Restore E2E suite manifest and report smoke test.
 * This file intentionally does not import the scenario test modules because
 * those modules are executed separately by the test runner wildcard.
 * @module tests/e2e/workflows/restore/index
 */

import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeReport } from '../../helpers/report-writer.mjs';

const REPORT_OUTPUT = process.env.RESTORE_TEST_REPORT_OUTPUT ?? 'restore-test-report.json';

const scenarios = [
  { id: 'E1', name: 'Restauración total sobre tenant vacío (golden path)' },
  { id: 'E2', name: 'Restauración parcial por subconjunto de dominios' },
  { id: 'E3', name: 'Restauración con conflictos preexistentes' },
  { id: 'E4', name: 'Restauración con artefacto degradado' },
  { id: 'E5', name: 'Restauración con migración de formato' },
  { id: 'EC1', name: 'Fallo parcial y reintento posterior' },
  { id: 'EC2', name: 'Tenant de origen inexistente en destino' },
  { id: 'EC3', name: 'Restauración concurrente bloqueada' },
  { id: 'EC4', name: 'Artefacto de tamaño máximo' },
  { id: 'EC5', name: 'Restauración sobre tenant suspendido' },
];

test('Restore suite manifest report can be written', () => {
  const started = new Date().toISOString();
  const report = {
    report_id: randomUUID(),
    execution_id: `manifest-${randomUUID()}`,
    started_at: started,
    finished_at: started,
    duration_ms: 0,
    environment: {
      api_base_url: process.env.RESTORE_TEST_API_BASE_URL ?? 'http://localhost:9080',
      domains_enabled: (process.env.RESTORE_TEST_DOMAINS_ENABLED ?? 'iam,postgres_metadata,kafka,storage').split(','),
      ow_enabled: process.env.RESTORE_TEST_OW_ENABLED === 'true',
      mongo_enabled: process.env.RESTORE_TEST_MONGO_ENABLED === 'true',
    },
    summary: { total: scenarios.length, passed: 0, failed: 0, skipped: scenarios.length },
    scenarios: scenarios.map(s => ({
      scenario_id: s.id,
      name: s.name,
      status: 'skip',
      duration_ms: 0,
      skip_reason: 'manifest-only smoke test',
      correlation_id: `manifest-${s.id}`,
    })),
  };

  writeReport(report, REPORT_OUTPUT);
});
