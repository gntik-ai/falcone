/**
 * Black-box test suite for spec change add-console-flow-yaml-editor.
 *
 * Drives the PUBLIC surface ONLY — browserless, node-side checks that do NOT mount
 * React or Monaco. The DOM-heavy editor/view-switcher behaviour is covered by the
 * vitest component suite; here we assert the contracts a consumer can verify without
 * a browser:
 *   - the new runtime dependencies are declared on the web-console package,
 *   - the lazy-load boundary holds (Monaco is never imported by the shell/router source),
 *   - the YAML serialiser module is a framework-free ESM module that runs under plain
 *     node and produces a lossless, deterministic graph -> YAML -> graph round-trip over
 *     every shared DSL fixture (canvasMetadata compared independently).
 *
 * The serialiser is consumed here through the same alias the app uses (`@/...`), resolved
 * manually to an absolute source path so the test exercises the real module, not a copy.
 *
 * Scenario coverage (capability: workflows / spec.md):
 *   bbx-console-yml-001  monaco-editor, monaco-yaml and yaml are declared deps
 *   bbx-console-yml-002  Monaco is isolated in its own Vite chunk (manualChunks config)
 *   bbx-console-yml-003  No shell/router/main source statically imports monaco-*
 *   bbx-console-yml-004  Serialiser module exports the documented pure functions
 *   bbx-console-yml-005  Deterministic serialisation: same graph -> byte-identical YAML
 *   bbx-console-yml-006  canvasMetadata is the last top-level key in the YAML output
 *   bbx-console-yml-007  Round-trip identity over all five fixtures (canvasMetadata apart)
 *   bbx-console-yml-008  Comment policy: re-serialising from the model drops YAML comments
 *   bbx-console-yml-009  Invalid YAML parse fails loudly without mutating any input
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const WEB_CONSOLE = resolve(REPO_ROOT, 'apps/web-console');
const FIXTURE_DIR = resolve(REPO_ROOT, 'packages/internal-contracts/src/fixtures/flows');

// The serialiser deliberately uses no `@/` aliases or React imports so it loads under
// plain node. Import it via a file URL to the real source.
const serialiserUrl = pathToFileURL(resolve(WEB_CONSOLE, 'src/lib/flows/yaml-serialiser.ts')).href;

function readPackageJson() {
  return JSON.parse(readFileSync(resolve(WEB_CONSOLE, 'package.json'), 'utf8'));
}

function loadFixtures() {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, doc: JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), 'utf8')) }));
}

// --- bbx-console-yml-001 -------------------------------------------------------------
test('bbx-console-yml-001 monaco-editor, monaco-yaml and yaml are declared runtime deps', () => {
  const pkg = readPackageJson();
  const deps = pkg.dependencies ?? {};
  for (const name of ['monaco-editor', 'monaco-yaml', 'yaml']) {
    assert.ok(typeof deps[name] === 'string' && deps[name].length > 0, `${name} must be a declared dependency`);
  }
});

// --- bbx-console-yml-002 -------------------------------------------------------------
test('bbx-console-yml-002 Monaco is isolated in its own Vite chunk via manualChunks', () => {
  const config = readFileSync(resolve(WEB_CONSOLE, 'vite.config.ts'), 'utf8');
  assert.match(config, /manualChunks/, 'vite.config.ts must configure manualChunks');
  assert.match(config, /monaco/, 'vite.config.ts must reference a monaco chunk');
});

// --- bbx-console-yml-003 -------------------------------------------------------------
test('bbx-console-yml-003 no shell/router/main source statically imports monaco-*', () => {
  // The lazy-load boundary: only the FlowYamlEditor (and the editor it composes) may pull
  // monaco in, and only behind a dynamic import(). The shell/router/entry must stay clean.
  const guarded = ['src/main.tsx', 'src/router.tsx', 'src/App.tsx'];
  for (const rel of guarded) {
    let source;
    try {
      source = readFileSync(resolve(WEB_CONSOLE, rel), 'utf8');
    } catch {
      continue; // file may not exist in this layout; nothing to guard
    }
    assert.doesNotMatch(
      source,
      /^\s*import[^\n]*['"]monaco-(editor|yaml)/m,
      `${rel} must not statically import monaco-editor / monaco-yaml`
    );
  }
});

// --- bbx-console-yml-004 -------------------------------------------------------------
test('bbx-console-yml-004 serialiser module exports the documented pure functions', async () => {
  const mod = await import(serialiserUrl);
  assert.equal(typeof mod.serializeFlowToYaml, 'function');
  assert.equal(typeof mod.parseYamlToFlow, 'function');
  assert.equal(typeof mod.FLOW_TOP_LEVEL_KEY_ORDER, 'object');
});

// --- bbx-console-yml-005 -------------------------------------------------------------
test('bbx-console-yml-005 deterministic serialisation: same graph -> byte-identical YAML', async () => {
  const { serializeFlowToYaml } = await import(serialiserUrl);
  for (const { name, doc } of loadFixtures()) {
    const once = serializeFlowToYaml(doc);
    const twice = serializeFlowToYaml(doc);
    assert.equal(once, twice, `serialisation of ${name} must be byte-identical across calls`);
    assert.equal(typeof once, 'string');
    assert.ok(once.length > 0, `serialisation of ${name} must be non-empty`);
  }
});

// --- bbx-console-yml-006 -------------------------------------------------------------
test('bbx-console-yml-006 canvasMetadata is the last top-level key when present', async () => {
  const { serializeFlowToYaml } = await import(serialiserUrl);
  const doc = {
    apiVersion: 'v1.0',
    name: 'with-canvas',
    nodes: [{ id: 'only', type: 'task', taskType: 'noop' }],
    canvasMetadata: { nodes: { only: { x: 10, y: 20 } } }
  };
  const yaml = serializeFlowToYaml(doc);
  const topLevelKeys = yaml
    .split('\n')
    .filter((line) => /^[A-Za-z]/.test(line))
    .map((line) => line.split(':')[0]);
  assert.equal(topLevelKeys.at(-1), 'canvasMetadata', 'canvasMetadata must be the last top-level key');
  assert.ok(topLevelKeys.indexOf('apiVersion') < topLevelKeys.indexOf('canvasMetadata'));
});

// --- bbx-console-yml-007 -------------------------------------------------------------
test('bbx-console-yml-007 round-trip identity over all five fixtures', async () => {
  const { serializeFlowToYaml, parseYamlToFlow } = await import(serialiserUrl);
  const fixtures = loadFixtures();
  assert.ok(fixtures.length >= 5, 'expected at least five DSL fixtures');
  for (const { name, doc } of fixtures) {
    const yaml = serializeFlowToYaml(doc);
    const back = parseYamlToFlow(yaml);
    // Compare execution semantics (everything except canvasMetadata) and canvasMetadata apart.
    const { canvasMetadata: origMeta, ...origRest } = doc;
    const { canvasMetadata: backMeta, ...backRest } = back;
    assert.deepEqual(backRest, origRest, `round-trip of ${name} must preserve execution semantics`);
    assert.deepEqual(backMeta ?? null, origMeta ?? null, `round-trip of ${name} must preserve canvasMetadata`);
  }
});

// --- bbx-console-yml-008 -------------------------------------------------------------
test('bbx-console-yml-008 comment policy: re-serialising from the model drops comments', async () => {
  const { serializeFlowToYaml, parseYamlToFlow } = await import(serialiserUrl);
  const doc = {
    apiVersion: 'v1.0',
    name: 'commented',
    nodes: [{ id: 'only', type: 'task', taskType: 'noop' }]
  };
  const withComment = `# a human note\n${serializeFlowToYaml(doc)}`;
  assert.match(withComment, /# a human note/);
  // Parse-then-reserialise mirrors the canvas round-trip: comments are NOT carried over.
  const reserialised = serializeFlowToYaml(parseYamlToFlow(withComment));
  assert.doesNotMatch(reserialised, /# a human note/, 'canvas round-trip must discard YAML comments');
});

// --- bbx-console-yml-009 -------------------------------------------------------------
test('bbx-console-yml-009 invalid YAML fails loudly without mutating inputs', async () => {
  const { parseYamlToFlow } = await import(serialiserUrl);
  const broken = 'name: [unterminated\nnodes:\n  - id: a\n  type: task'; // syntactically invalid
  assert.throws(() => parseYamlToFlow(broken), 'invalid YAML must throw');
});
