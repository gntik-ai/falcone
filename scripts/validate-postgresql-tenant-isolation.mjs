import { existsSync, readFileSync } from 'node:fs';

const requiredFiles = [
  'docs/tasks/us-prg-02-t01.md',
  'docs/adr/0002-postgresql-tenant-isolation.md',
  'docs/reference/postgresql/tenant-isolation-baseline.sql',
  'tests/e2e/postgresql-tenant-isolation/README.md'
];

const missingFiles = requiredFiles.filter((file) => !existsSync(file));

if (missingFiles.length > 0) {
  console.error('Missing PostgreSQL tenant-isolation ADR package files:');
  for (const file of missingFiles) console.error(`- ${file}`);
  process.exit(1);
}

const adrPath = 'docs/adr/0002-postgresql-tenant-isolation.md';
const adr = readFileSync(adrPath, 'utf8');
const requiredAdrSections = [
  '## Status',
  '## Context',
  '## Decision Drivers',
  '## Options Considered',
  '## Decision',
  '## Guardrails',
  '## Consequences',
  '## Rollout and Rollback'
];

const missingAdrSections = requiredAdrSections.filter((section) => !adr.includes(section));
if (missingAdrSections.length > 0) {
  console.error(`ADR is missing required sections in ${adrPath}:`);
  for (const section of missingAdrSections) console.error(`- ${section}`);
  process.exit(1);
}

const requiredAdrTerms = [
  'schema-per-tenant',
  'database-per-tenant',
  'hybrid',
  'RLS',
  'rollback'
];

const missingAdrTerms = requiredAdrTerms.filter((term) => !adr.toLowerCase().includes(term.toLowerCase()));
if (missingAdrTerms.length > 0) {
  console.error(`ADR is missing required terms in ${adrPath}:`);
  for (const term of missingAdrTerms) console.error(`- ${term}`);
  process.exit(1);
}

const sqlPath = 'docs/reference/postgresql/tenant-isolation-baseline.sql';
const sql = readFileSync(sqlPath, 'utf8');
for (const token of ['CREATE ROLE platform_runtime', 'ENABLE ROW LEVEL SECURITY', 'CREATE SCHEMA IF NOT EXISTS control']) {
  if (!sql.includes(token)) {
    console.error(`SQL reference is missing expected token in ${sqlPath}: ${token}`);
    process.exit(1);
  }
}

const testsPath = 'tests/e2e/postgresql-tenant-isolation/README.md';
const testsDoc = readFileSync(testsPath, 'utf8');
for (const scenario of ['PG-ISO-001', 'PG-ISO-006', 'PG-ISO-010']) {
  if (!testsDoc.includes(scenario)) {
    console.error(`Isolation verification matrix is missing scenario ${scenario} in ${testsPath}`);
    process.exit(1);
  }
}

console.log('PostgreSQL tenant-isolation ADR package is present and auditable.');
