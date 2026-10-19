import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReports } from './report.mjs';

export default class ParityReporter {
  onBegin(config, suite) { this.suite = suite; this.config = config; }
  onEnd(run) {
    const rows = this.suite.allTests().flatMap((test) => {
      const group = test.titlePath().find((name) => name.includes(' | '));
      if (!group) return [];
      const [page, role, locale] = group.split(' | ');
      const results = test.results;
      const passed = test.expectedStatus === 'passed' && results.length === 1 && results[0].status === 'passed';
      return [{ page, role, locale, check: test.title, status: passed ? 'passed' : (results.at(-1)?.status === 'passed' ? 'unexpected' : results.at(-1)?.status ?? 'not-run'), errors: results.flatMap((r) => r.errors.map((e) => e.message)) }];
    });
    const dir = process.env.PARITY_REPORT_DIR ?? 'test-results/parity';
    mkdirSync(dir, { recursive: true });
    for (const report of buildReports(rows)) {
      // A failed global setup/teardown cannot certify a page.
      if (run.status !== 'passed') delete report.result;
      writeFileSync(join(dir, `${report.page}-${report.role}-${report.locale}.json`), JSON.stringify(report, null, 2));
    }
  }
}
