## Context

The web console (`apps/web-console`) is a Vite 6 / React 18 SPA with no existing
rich-text or code-editor dependency. The current `package.json` lists only UI
primitives (Radix, lucide-react, react-router-dom) and Tailwind; there is no Monaco
or yaml-parsing library today. Vitest runs under jsdom with `@testing-library/react`
16; the setup file is `apps/web-console/src/test/setup.ts`.

The sibling change `add-flows-dsl-schema` (#358) places the authoritative
`flow-definition.json` JSON Schema at `services/internal-contracts/src/` and exports
it as `flowDefinitionSchema` from `@falcone/internal-contracts`. The sibling
`add-console-flow-designer` (#363) owns the graph model type (`FlowGraph`) and the
canvas component; this change consumes both as peer dependencies and MUST NOT redefine
them.

## Goals / Non-Goals

**Goals:**

- Integrate Monaco editor with monaco-yaml for schema-backed editing inside the
  existing console shell without touching the main bundle critical path.
- Define and enforce a lossless, deterministic YAML serialisation contract so that
  canvas and YAML are always in sync.
- Provide a `FlowViewSwitcher` with dirty-state and graceful degradation semantics.
- Property-based round-trip tests over all five DSL fixtures.

**Non-Goals:**

- Git-style version diffing UI.
- Custom Monaco themes or branding beyond inheriting the console colour scheme.
- Server-side YAML parsing; the publish path is unchanged.
- Editing flows outside the Flows section (Monaco is not loaded globally).

## Decisions

### Decision 1: Monaco loaded via dynamic import, not a static dep

**Rationale:** `monaco-editor` is ~2 MB minified. Vite 6 supports dynamic `import()`
with `/* @vite-ignore */` annotations or explicit `build.rollupOptions.output.manualChunks`
for worker files. Monaco requires its editor workers to be served as separate files;
the recommended approach is `vite-plugin-monaco-editor` or manual `manualChunks` that
maps `monaco-editor/esm/vs/**` to a dedicated chunk. The manual chunk approach is
preferred here because it avoids an extra Vite plugin dependency and keeps the config
transparent.

`vite.config.ts` gains a `build.rollupOptions.output.manualChunks` entry:

```ts
'monaco-chunk': [
  'monaco-editor',
  'monaco-yaml',
]
```

The `FlowYamlEditor` component uses `React.lazy` + `Suspense` so the chunk is only
fetched when the editor is first rendered.

**Alternatives considered:** `vite-plugin-monaco-editor` — adds a dependency that
tracks Monaco's worker-loading mechanism and may fall behind on version bumps; rejected
in favour of explicit config.

### Decision 2: YAML library — yaml (eemeli/yaml) for CST-aware parsing

**Rationale:** The comment normalisation policy requires knowing when comments are
present (to preserve them during YAML-only edits) and discarding them on canvas
round-trips. `yaml` (npm: `yaml`, eemeli) exposes a CST / Document API that lets the
serialiser detect and drop comment nodes during re-serialisation from the graph model.
It is also the library used by monaco-yaml internally, eliminating version skew.

**Alternatives considered:** `js-yaml` — no CST API, comments are always lost, making
it impossible to implement even the "preserve during YAML-only edit" half of the policy;
rejected.

### Decision 3: Deterministic key order via schema-property-order algorithm

**Rationale:** The spec requires byte-identical output for the same logical graph.
The serialiser iterates keys in the order they appear in the JSON Schema `properties`
object (which is stable because JSON Schema `properties` is a JSON object — insertion
order is preserved in V8). Keys not in `properties` (e.g. dynamic `canvasMetadata`
child keys) are sorted alphabetically. `canvasMetadata` is appended last by convention
because it is the last declared top-level property in `flow-definition.json`.

### Decision 4: Semantic validation runs client-side in a Web Worker

**Rationale:** The semantic rules (FLW-E001…FLW-E009) include cycle detection (FLW-E002)
which is O(n+e). Running this on the main thread inside Monaco's change event could
cause jank on large flows. A tiny Web Worker (bundled as a Vite worker module using
`new Worker(new URL('./flows/semantic-worker.ts', import.meta.url), {type: 'module'})`)
receives serialised JSON of the parsed document and returns an array of `{code, line}`
errors. Monaco markers are updated from the worker's response via `postMessage`.

**Alternatives considered:** Main-thread debounced validation — simpler but risks
visible latency on large flows; rejected for production quality.

### Decision 5: Draft-save guard at the auto-save call site

**Rationale:** The graceful-degradation requirement mandates that an invalid YAML
document never triggers a `PATCH /flows/:id` call. The guard is implemented as a
boolean ref `isDocumentValid` updated by the Monaco `onDidChangeModelDecorations`
callback. The auto-save timer checks `isDocumentValid` before dispatching the save
action. This is the simplest correct pattern given that Monaco's validation is async.

## Risks / Trade-offs

- **Monaco bundle size** — even code-split, the Monaco chunk is large (~1.5–2 MB gzipped).
  The spec requires the measured bundle impact to be recorded; add a CI step that prints
  `vite build --outDir dist 2>&1 | grep monaco-chunk` to track the size.
  Mitigation: the lazy chunk is only loaded on the Flows YAML editor route.

- **Worker file serving in development** — Vite dev server serves worker files correctly
  via the native worker plugin; production builds require the worker URLs to be stable.
  Mitigation: use `import.meta.url`-relative worker instantiation so Vite can resolve
  it at build time.

- **jsdom does not support Web Workers in vitest** — component tests that exercise the
  semantic validation path will need to mock the worker using `vi.mock`. The round-trip
  tests do not involve the DOM and run in a plain Node environment.

- **Broken vitest baseline** — CLAUDE.md notes that ~66 tests already fail on main.
  New tests MUST pass; the failing count MUST NOT grow. Tests for `FlowYamlEditor` and
  `FlowViewSwitcher` MUST mock Monaco and the `yaml` library to avoid ESM incompatibility
  in jsdom.

## Migration Plan

1. Add `monaco-editor`, `monaco-yaml`, and `yaml` to `apps/web-console/package.json`
   dependencies (runtime); no new devDependencies needed beyond those already present.
2. Extend `vite.config.ts` with `build.rollupOptions.output.manualChunks`.
3. Implement `lib/flows/yaml-serialiser.ts` and `lib/flows/yaml-round-trip.ts`; tests
   first (property-based round-trip over fixtures).
4. Implement `lib/flows/semantic-worker.ts` (worker) and wire to Monaco marker API.
5. Implement `FlowYamlEditor.tsx` (Monaco host component) and `FlowViewSwitcher.tsx`.
6. Wire `FlowViewSwitcher` into the existing Flows route rendered by
   `add-console-flow-designer`; no route-level change needed — the switcher replaces
   the canvas-only render.
7. Verify vitest baseline is not regressed.

Rollback: all new files are additive; reverting the package.json and vite.config.ts
changes and removing the new source files fully reverts the feature.

## Open Questions

- **Schema URL for monaco-yaml**: `monaco-yaml` requires either an inline schema object
  or a URI it can fetch. Inlining the JSON Schema object (imported from
  `@falcone/internal-contracts`) is the safe approach to avoid CORS issues in
  production builds; confirm with the add-flows-dsl-schema implementer that the export
  is a plain JSON object (not a module with side effects).
- **Side-by-side layout breakpoint**: no mobile breakpoint is defined for the
  side-by-side mode; this is deferred to the design system work in a follow-up.
