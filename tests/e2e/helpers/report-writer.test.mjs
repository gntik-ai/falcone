/**
 * Unit tests for restore test report writer.
 * @module tests/e2e/helpers/report-writer.test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeReport } from './report-writer.mjs';

test('writeReport writes valid report and companion text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-report-'));
  const out = join(dir, 'report.json');
  const report = {
    report_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    execution_id: '7f3a1b9c-2d4e-4f5a-8b6c-0e1d2f3a4b5c',
    started_at: '2026-04-01T19:00:00.000Z',
    finished_at: '2026-04-01T19:00:01.000Z',
    duration_ms: 1000,
    environment: {
      api_base_url: 'http://sandbox-apisix:9080',
      domains_enabled: ['iam', 'postgres_metadata'],
      ow_enabled: false,
      mongo_enabled: false,
    },
    summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    scenarios: [
      {
        scenario_id: 'E1',
        name: 'Golden path',
        status: 'pass',
        duration_ms: 12,
        correlation_id: 'restore-e2e-abc-E1',
        tenants: { src_tenant_id: 'src', dst_tenant_id: 'dst' },
      },
    ],
  };

  writeReport(report, out);
  assert.ok(existsSync(out));
  assert.ok(existsSync(`${out}.txt`));
  const saved = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(saved.report_id, report.report_id);
});

test('writeReport rejects invalid report objects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'restore-report-'));
  const out = join(dir, 'report.json');
  assert.throws(() => writeReport({ hello: 'world' }, out), /Report validation failed/);
});
