// Black-box test suite for change add-flows-adr-temporal-spikes.
// Asserts — through the public deliverable surface only (files on disk, no internal imports) —
// that (1) the Temporal-adoption ADR is recorded in docs-site/architecture/adrs.md with all
// seven required decision fields incl. the two SDK code-evidence citations, and (2) the spike
// evidence artifacts exist and are non-empty: Spike A history export + chosen expression engine,
// Spike B measurements (N=1/5/20) + the four-row comparison table.
//
// Deterministic and dependency-free: node:test + node:fs only. No spike code is imported.
//
// Tests: bbx-flows-adr-001 .. bbx-flows-adr-010
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SPIKE = resolve(REPO, 'spikes/add-flows-adr-temporal-spikes');
const ADR_FILE = resolve(REPO, 'docs-site/architecture/adrs.md');

function read(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
function nonEmptyFile(path) {
  return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
}

// The Temporal ADR is the LAST/newest entry; isolate it so keyword assertions don't accidentally
// match earlier ADRs. We locate the ADR whose body mentions Temporal.
function temporalAdrSection() {
  const text = read(ADR_FILE);
  const sections = text.split(/^## /m).map((s) => (s.startsWith('ADR') ? '## ' + s : s));
  return sections.find((s) => /temporal/i.test(s) && /^## ADR-\d+/m.test(s)) ?? '';
}

// ---------------------------------------------------------------------------------------
// (1) ADR present with all seven required decision fields
// ---------------------------------------------------------------------------------------

// bbx-flows-adr-001: a Temporal ADR entry exists in the numbered ADR file.
test('bbx-flows-adr-001: Temporal adoption ADR is recorded in adrs.md', () => {
  const adr = temporalAdrSection();
  assert.ok(adr.length > 0, 'no ADR section mentioning Temporal found in docs-site/architecture/adrs.md');
  assert.match(adr, /^## ADR-\d+\b/m, 'ADR must follow the numbered "## ADR-N" heading format');
  assert.match(adr, /temporal/i, 'ADR must concern Temporal');
});

// bbx-flows-adr-002: all seven required decision fields are detectable.
test('bbx-flows-adr-002: ADR contains all seven required decision fields', () => {
  const adr = temporalAdrSection();
  // 1. rationale (durable execution / ms dispatch / namespaces / MIT license)
  assert.match(adr, /durable execution/i, 'field 1: durable-execution rationale');
  assert.match(adr, /MIT/i, 'field 1: MIT license rationale');
  // 2. SDK choice (TypeScript) — evidence checked in bbx-003/004
  assert.match(adr, /typescript sdk/i, 'field 2: TypeScript SDK choice');
  // 3. tenancy model
  assert.match(adr, /shared namespace/i, 'field 3: tenancy model');
  assert.match(adr, /search attribute/i, 'field 3: tenancy model mechanism');
  // 4. definition-passing strategy
  assert.match(adr, /definition[- ]passing|definition as (?:workflow )?input/i, 'field 4: definition-passing strategy');
  // 5. expression engine
  assert.match(adr, /expression engine/i, 'field 5: expression engine field');
  assert.match(adr, /\b(CEL|JSONata)\b/i, 'field 5: a concrete engine named');
  // 6. PostgreSQL SQL visibility decision
  assert.match(adr, /visibility/i, 'field 6: visibility decision');
  assert.match(adr, /postgresql|postgres/i, 'field 6: PostgreSQL visibility store');
  // 7. internal-only + operator-only UI stance
  assert.match(adr, /internal[- ]only/i, 'field 7: Temporal internal-only stance');
  assert.match(adr, /operator[- ]only/i, 'field 7: Web UI operator-only stance');
});

// bbx-flows-adr-003: SDK choice cites Dockerfile FROM node:22 evidence.
test('bbx-flows-adr-003: ADR cites the node:22 Dockerfile SDK evidence', () => {
  const adr = temporalAdrSection();
  assert.match(adr, /apps\/control-plane\/Dockerfile/i, 'must cite the control-plane Dockerfile');
  assert.match(adr, /node:22/i, 'must cite FROM node:22');
});

// bbx-flows-adr-004: SDK choice cites the "type":"module" package.json evidence.
test('bbx-flows-adr-004: ADR cites the "type":"module" package.json SDK evidence', () => {
  const adr = temporalAdrSection();
  assert.match(adr, /apps\/control-plane\/package\.json/i, 'must cite the control-plane package.json');
  assert.match(adr, /"type"\s*:\s*"module"/i, 'must cite "type":"module"');
});

// ---------------------------------------------------------------------------------------
// (2) Spike evidence artifacts exist and are non-empty
// ---------------------------------------------------------------------------------------

// bbx-flows-adr-005: Spike A history export exists and is non-empty.
test('bbx-flows-adr-005: Spike A worker-kill history export exists and is non-empty', () => {
  const history = resolve(SPIKE, 'spike-a/evidence/kill-resume-history.json');
  assert.ok(nonEmptyFile(history), 'spike-a/evidence/kill-resume-history.json missing or empty');
  const parsed = JSON.parse(read(history));
  assert.ok(Array.isArray(parsed.events) && parsed.events.length > 0, 'history must contain recorded events');
  // The workflow must have COMPLETED (resume proof).
  const completed = parsed.events.some((e) => e.workflowExecutionCompletedEventAttributes);
  assert.ok(completed, 'history must show WorkflowExecutionCompleted (resume to completion)');
});

// bbx-flows-adr-006: expression-engines.md names EXACTLY ONE chosen engine.
test('bbx-flows-adr-006: expression-engines.md selects exactly one engine', () => {
  const doc = read(resolve(SPIKE, 'spike-a/expression-engines.md'));
  assert.ok(doc.length > 0, 'spike-a/expression-engines.md missing');
  const m = doc.match(/Chosen engine:\s*`?([A-Za-z0-9_-]+)/i);
  assert.ok(m, 'expression-engines.md must declare "Chosen engine: <engine>"');
  const chosen = m[1].toLowerCase();
  assert.ok(/cel/.test(chosen) || /jsonata/.test(chosen), `chosen engine must be CEL or JSONata, got "${m[1]}"`);
  // Exactly one: the OTHER engine must not also be declared "Chosen engine:".
  const allChosen = [...doc.matchAll(/Chosen engine:\s*`?([A-Za-z0-9_-]+)/gi)];
  assert.equal(allChosen.length, 1, 'exactly one "Chosen engine:" declaration is allowed');
});

// bbx-flows-adr-007: Spike B measurements.md has data rows for N = 1, 5, and 20.
test('bbx-flows-adr-007: Spike B measurements.md has N=1/5/20 data rows', () => {
  const doc = read(resolve(SPIKE, 'spike-b/measurements.md'));
  assert.ok(doc.length > 0, 'spike-b/measurements.md missing');
  // Markdown data rows begin with "| N |" values; require a numeric leading cell for each N.
  for (const n of [1, 5, 20]) {
    const rowRe = new RegExp(`^\\|\\s*${n}\\s*\\|`, 'm');
    assert.match(doc, rowRe, `measurements.md must have a data row for N=${n}`);
  }
});

// bbx-flows-adr-008: Spike B measurements.md states the PostgreSQL visibility verdict.
test('bbx-flows-adr-008: measurements.md states the PostgreSQL SQL-visibility verdict', () => {
  const doc = read(resolve(SPIKE, 'spike-b/measurements.md'));
  assert.match(doc, /postgresql sql visibility is sufficient/i, 'must state PostgreSQL SQL visibility is SUFFICIENT');
  assert.match(doc, /elasticsearch is not required|elasticsearch.{0,20}not required/i, 'must state Elasticsearch is not required');
});

// bbx-flows-adr-009: Spike B comparison-table.md has the four required rows.
test('bbx-flows-adr-009: comparison-table.md has the four required dimension rows', () => {
  const doc = read(resolve(SPIKE, 'spike-b/comparison-table.md'));
  assert.ok(doc.length > 0, 'spike-b/comparison-table.md missing');
  assert.match(doc, /isolation boundary/i, 'row: isolation boundary');
  assert.match(doc, /poller count per N tenants/i, 'row: poller count per N tenants');
  assert.match(doc, /gRPC connection count per N tenants/i, 'row: gRPC connection count per N tenants');
  assert.match(doc, /operational complexity/i, 'row: operational complexity');
  // Both models present as columns.
  assert.match(doc, /namespace-per-tenant/i, 'column: namespace-per-tenant');
  assert.match(doc, /shared namespace/i, 'column: shared namespace');
});

// bbx-flows-adr-010: Spike A sandbox-check + replay evidence and Spike B measurements.json exist.
test('bbx-flows-adr-010: supporting machine-readable spike evidence is present and non-empty', () => {
  for (const rel of [
    'spike-a/evidence/sandbox-check.json',
    'spike-a/evidence/replay-result.json',
    'spike-b/evidence/measurements.json',
  ]) {
    const p = resolve(SPIKE, rel);
    assert.ok(nonEmptyFile(p), `${rel} missing or empty`);
  }
  // sandbox-check must record both engines tested; replay must be deterministic.
  const sandbox = JSON.parse(read(resolve(SPIKE, 'spike-a/evidence/sandbox-check.json')));
  assert.ok(sandbox.probes && sandbox.probes['cel-js'] && sandbox.probes['jsonata'], 'both engines must be probed in the sandbox');
  const replay = JSON.parse(read(resolve(SPIKE, 'spike-a/evidence/replay-result.json')));
  assert.equal(replay.replay.deterministic, true, 'SDK replay must be deterministic');
});
