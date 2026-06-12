## Why

Power users require a text-first editing experience for flow definitions, and the canvas
and YAML must be two synchronised views of one canonical document — the YAML — so that
neither view loses data when the other is edited. Without Monaco + monaco-yaml wired to
the versioned DSL JSON Schema (add-flows-dsl-schema, #358), inline autocomplete,
hover docs, and line-anchored diagnostics are absent from the console. This change
closes that gap for GitHub issue #364, epic #355.

## What Changes

- New runtime dependencies `monaco-editor` and `monaco-yaml` added to
  `apps/web-console/package.json`; both loaded lazily behind a dynamic `import()` and
  code-split as their own Vite chunk so the main bundle is not impacted.
- New `FlowYamlEditor` React component (Vite 6 / React 18) that hosts the Monaco editor
  instance, configures the monaco-yaml language service, and wires it to the versioned
  `flow-definition.json` JSON Schema from `@falcone/internal-contracts`.
- Deterministic YAML serialisation: canvas→YAML uses a stable key-order serialiser so
  that repeated round-trips produce identical output; `canvasMetadata` is always written
  to the dedicated top-level section defined by the schema.
- Lossless YAML→graph round-trip with a documented comment-handling policy: YAML comments
  are normalised (discarded) on canvas edit and the policy is documented in `design.md`.
- View switcher component (`FlowViewSwitcher`) with three modes — canvas, YAML, side-by-side
  — including dirty-state tracking and conflict handling when both panes carry unsaved edits.
- Graceful degradation: when the YAML editor holds syntactically or semantically invalid
  content the canvas retains the last-valid graph and displays a banner; diagnostics are
  shown as Monaco markers anchored to the offending lines; the stored draft is never
  written while the document is invalid.
- Semantic validation error codes (`FLW-E001`…`FLW-E009`, from the schema change) are
  surfaced as Monaco markers in addition to structural JSON Schema diagnostics.
- Property-based round-trip test suite: graph→YAML→graph identity verified over all
  example fixtures from `services/internal-contracts/src/fixtures/flows/`.
- New vitest component tests follow the broken-baseline rule from CLAUDE.md: new tests
  MUST pass; the pre-existing failing set MUST NOT grow.

## Capabilities

### New Capabilities

- `workflows`: YAML editor slice of the workflows capability — Monaco + monaco-yaml
  wired to the DSL JSON Schema, lossless round-trip sync between canvas and YAML,
  view switcher, graceful degradation, and property-based round-trip tests. This delta
  extends the `workflows` spec started by add-flows-dsl-schema; it does NOT duplicate
  schema or semantic-validation requirements already specified there.

### Modified Capabilities

(none — the `workflows` spec entry in add-flows-dsl-schema is not yet archived; this
change adds ADDED requirements into a new spec delta for the same capability)

## Impact

- **apps/web-console/package.json**: new deps `monaco-editor`, `monaco-yaml`.
- **apps/web-console/vite.config.ts**: manual chunk split for Monaco workers (required by
  Vite 6 + Monaco's web-worker architecture).
- **apps/web-console/src/**: new `components/flows/FlowYamlEditor.tsx`,
  `components/flows/FlowViewSwitcher.tsx`, `lib/flows/yaml-serialiser.ts`,
  `lib/flows/yaml-round-trip.ts`.
- **apps/web-console/src/__tests__/**: new component tests and round-trip property tests.
- **Sibling dependencies (must be complete before implement):**
  - `add-flows-dsl-schema` (#358) — provides `flow-definition.json` + fixtures.
  - `add-console-flow-designer` (#363) — provides the shared graph model consumed here.
- **Downstream blocked:** `add-console-flow-monitoring` (#367).
- No server-side or API changes; publish path is unchanged (server validation remains
  authoritative per add-flows-control-plane-api).
