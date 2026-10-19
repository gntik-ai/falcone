import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const inputs = process.argv.slice(2);
const rules = [
  ['JWT', /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
  ['Bearer', /\bBearer\s+(?!synthetic-)[A-Za-z0-9._~+\/-]+/g],
  ['PRIVATE KEY', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g],
  ['synthetic-id', /["']?\b(?:tenantId|workspaceId|userId|sessionId)["']?\s*:\s*(?:"(?!synthetic-)[^"\r\n]*"|'(?!synthetic-)[^'\r\n]*'|`(?!synthetic-)[^`\r\n]*`|(?!synthetic-)[A-Za-z0-9_$][^\s,;}\]#]*)/g],
];
let failed = false;
function scan(file) {
  if (statSync(file).isDirectory()) {
    for (const entry of readdirSync(file, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) scan(join(file, entry.name));
    }
    return;
  }
  const text = readFileSync(file, 'utf8');
  for (const [name, rule] of rules) {
    for (const match of text.matchAll(rule)) {
      const line = text.slice(0, match.index).split('\n').length;
      console.error(`${file}:${line}: ${name}`);
      failed = true;
    }
  }
}
try {
  for (const file of inputs.length ? inputs : [join(here, 'fixtures'), resolve(here, '../../../../packages/console-api/src/fixtures.ts')]) scan(resolve(file));
} catch (error) { console.error(error.message); failed = true; }
process.exitCode = failed ? 1 : 0;
