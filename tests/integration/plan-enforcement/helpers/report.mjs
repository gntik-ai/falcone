/**
 * Structured test report generator.
 *
 * Accumulates results during the suite run and writes a JSON report
 * conforming to the schema in plan.md § "Reporte de resultados".
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export class TestReporter {
  constructor() {
    /** @type {Array<object>} */
    this.results = [];
    this.startTime = Date.now();
  }

  /**
   * Record a test result.
   * @param {object} entry
   * @param {string} entry.name
   * @param {string} entry.scenario
   * @param {string[]} entry.subsystems
   * @param {'pass'|'fail'|'skip'} entry.result
   * @param {number} entry.durationMs
   * @param {string} [entry.detail]
   */
  addResult(entry) {
    this.results.push({
      name: entry.name,
      scenario: entry.scenario,
      subsystems: entry.subsystems,
      result: entry.result,
      duration_ms: entry.durationMs,
      ...(entry.detail ? { detail: entry.detail } : {}),
    });
  }

  /**
   * Summary counts.
   * @returns {{ total: number, passed: number, failed: number, skipped: number }}
   */
  getSummary() {
    return {
      total: this.results.length,
      passed: this.results.filter((r) => r.result === 'pass').length,
      failed: this.results.filter((r) => r.result === 'fail').length,
      skipped: this.results.filter((r) => r.result === 'skip').length,
    };
  }

  /**
   * Write the JSON report to disk.
   * @param {string} outputPath
   */
  async writeReport(outputPath) {
    const report = {
      suite: 'plan-enforcement-coherence',
      timestamp: new Date().toISOString(),
      environment: process.env.TEST_ENVIRONMENT ?? 'local',
      duration_ms: Date.now() - this.startTime,
      ...this.getSummary(),
      results: this.results,
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    return report;
  }
}
