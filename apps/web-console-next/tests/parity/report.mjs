import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checks } from './check-names.mjs';

export function buildReports(results) {
  const groups = new Map();
  for (const row of results) {
    const key = JSON.stringify([row.page, row.role, row.locale, row.viewport]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((rows) => {
    const { page, role, locale, viewport } = rows[0];
    const complete = rows.length === checks.length && checks.every((name) => rows.filter((r) => r.check === name && r.status === 'passed').length === 1);
    return { page, role, locale, ...(viewport ? { viewport } : {}), checks: rows.map(({ check, status, errors }) => ({ check, status, errors })), ...(complete ? { result: 'PARITY_PASS' } : {}) };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(buildReports(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
