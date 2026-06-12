## ADDED Requirements

### Requirement: Monaco editor is loaded lazily as a code-split chunk

The system SHALL load `monaco-editor` and `monaco-yaml` only when the user navigates to
a Flows section that requires the YAML editor, using a dynamic `import()` call that Vite
resolves into a separate chunk, so that the root bundle size of the web console is not
increased by Monaco's footprint.

#### Scenario: Monaco chunk is absent from the initial bundle
- **WHEN** `vite build` is executed for the web console
- **THEN** the output directory MUST contain a distinct chunk file whose name includes
  `monaco` that is NOT referenced by the main entry chunk's static import graph

#### Scenario: Editor renders after lazy load
- **WHEN** a user opens the YAML editor view for a flow
- **THEN** the `FlowYamlEditor` component MUST mount successfully after the dynamic import
  resolves and MUST display the Monaco editor surface

---

### Requirement: Monaco editor is wired to the versioned DSL JSON Schema for autocomplete and diagnostics

The system SHALL configure the `monaco-yaml` language service with the `flow-definition.json`
JSON Schema from `@falcone/internal-contracts` so that the editor provides keyword
autocomplete, hover documentation, and inline structural diagnostics against the full DSL.

#### Scenario: Autocomplete suggests valid node types
- **WHEN** a user types `type: ` inside a node block in the YAML editor
- **THEN** the editor MUST offer autocomplete suggestions containing at least
  `sequence`, `parallel`, `task`, `branch`, `wait`, `approval`, and `sub-flow`

#### Scenario: Structural diagnostic appears for unknown node type
- **WHEN** the YAML editor contains a node with `type: loop` (not in the schema enum)
- **THEN** the editor MUST display a red marker on that line without any server round-trip

#### Scenario: Hover shows documentation for a known keyword
- **WHEN** a user hovers over the `apiVersion` key in the editor
- **THEN** the editor MUST show a hover tooltip sourced from the JSON Schema description
  for that field

---

### Requirement: Semantic validation error codes are surfaced as Monaco markers

The system SHALL run the semantic validation rules (FLW-E001…FLW-E009, specified in
add-flows-dsl-schema) client-side after every document change and attach the resulting
errors as Monaco editor markers so that each error is anchored to its source line.

#### Scenario: Duplicate node ID produces a FLW-E001 marker
- **WHEN** the YAML editor contains two nodes with the same `id` value
- **THEN** a Monaco marker with severity Error MUST appear on the line of the second
  duplicate node, carrying the code `FLW-E001`

#### Scenario: Clean document produces no semantic markers
- **WHEN** the YAML editor contains a well-formed flow document that passes all semantic rules
- **THEN** no semantic markers MUST be present in the editor (structural markers from the
  JSON Schema language service are evaluated independently)

---

### Requirement: YAML is the canonical document with deterministic serialisation

The system SHALL treat the YAML document as the single source of truth. When the canvas
serialises a graph to YAML it MUST use a stable key-order algorithm (keys emitted in the
order defined by the JSON Schema `properties` array, then alphabetically for
`additionalProperties`) so that repeated canvas→YAML round-trips produce byte-identical
output for the same logical graph.  The `canvasMetadata` section MUST always be
serialised as the last top-level key.

#### Scenario: Canvas edit produces stable YAML output
- **WHEN** the same graph is serialised to YAML twice in succession without modification
- **THEN** both serialisation outputs MUST be byte-identical strings

#### Scenario: canvasMetadata is last key
- **WHEN** a flow document with canvas position data is serialised to YAML
- **THEN** `canvasMetadata` MUST appear as the final top-level key in the YAML output

---

### Requirement: Comment-handling policy is explicit and enforced

The system SHALL document and enforce a comment normalisation policy: YAML comments
entered in the editor are preserved while the user edits YAML directly; when the user
switches from YAML to canvas and then back to YAML, comments from the previous YAML
session are discarded and the YAML is re-serialised from the in-memory graph model.
This policy MUST be stated in a code comment adjacent to the serialiser entry point.

#### Scenario: Comments survive a YAML-only edit session
- **WHEN** a user types a comment `# my note` in the YAML editor and then makes a
  further YAML edit without switching to canvas
- **THEN** the comment MUST still be present in the editor content

#### Scenario: Comments are discarded after a canvas round-trip
- **WHEN** a user adds a comment in YAML, switches to canvas view, moves a node, and
  switches back to YAML
- **THEN** the comment MUST NOT appear in the re-serialised YAML output

---

### Requirement: Graph-to-YAML-to-graph round-trip is lossless for all example fixtures

The system SHALL provide a property-based test that, for each fixture in
`services/internal-contracts/src/fixtures/flows/`, serialises the parsed graph to YAML
and then deserialises back to a graph, and asserts that the resulting graph is
structurally equal to the original (deep equality on all fields except `canvasMetadata`
which is compared independently).

#### Scenario: Round-trip identity over minimal-3-node fixture
- **WHEN** `minimal-3-node.json` is parsed into a graph, serialised to YAML, and
  deserialised back to a graph
- **THEN** the resulting graph MUST deeply equal the original graph

#### Scenario: Round-trip identity over branch-retry fixture
- **WHEN** `branch-retry.json` is parsed into a graph, serialised to YAML, and
  deserialised back to a graph
- **THEN** the resulting graph MUST deeply equal the original graph

#### Scenario: canvasMetadata survives round-trip
- **WHEN** a flow document with non-empty `canvasMetadata` is serialised to YAML and
  deserialised
- **THEN** the `canvasMetadata` object MUST deeply equal the original

---

### Requirement: View switcher provides canvas, YAML, and side-by-side modes

The system SHALL provide a `FlowViewSwitcher` component that renders three mutually
exclusive mode buttons (canvas, YAML, side-by-side). The active mode MUST be reflected
in the component's visible state. Switching modes MUST NOT discard unsaved edits.

#### Scenario: Default mode is canvas
- **WHEN** the `FlowViewSwitcher` is first mounted for a new flow
- **THEN** the canvas mode button MUST be marked active and only the canvas pane MUST
  be visible

#### Scenario: Switching to YAML renders the editor
- **WHEN** a user clicks the YAML mode button
- **THEN** the YAML editor pane MUST become visible and the canvas pane MUST be hidden

#### Scenario: Side-by-side renders both panes
- **WHEN** a user clicks the side-by-side mode button
- **THEN** both the canvas pane and the YAML editor pane MUST be visible simultaneously

---

### Requirement: Dirty-state tracking and conflict handling across views

The system SHALL track dirty state per view independently. When the user has unsaved
edits in YAML and switches to canvas, the system MUST serialise the YAML changes into
the graph model before rendering the canvas. If the YAML is syntactically invalid at
switch time, the system MUST block the switch, display an inline error message, and
leave the user in the YAML view.

#### Scenario: Switching from dirty YAML to canvas flushes edits
- **WHEN** the user edits the YAML (valid content) and then clicks the canvas mode button
- **THEN** the canvas MUST reflect the changes from the YAML before being shown

#### Scenario: Switching from invalid YAML to canvas is blocked
- **WHEN** the YAML editor contains syntactically invalid YAML and the user clicks the
  canvas mode button
- **THEN** the view switch MUST NOT complete, an error banner MUST be shown, and the
  user MUST remain in YAML view

---

### Requirement: Invalid YAML degrades gracefully without corrupting the stored draft

The system SHALL ensure that while the YAML editor holds syntactically or semantically
invalid content: (a) the canvas displays the last-valid graph with a visible warning
banner; (b) line-anchored Monaco markers identify every error; (c) the `PATCH /flows/:id`
draft-save endpoint is NOT called, preserving the last-valid stored draft.

#### Scenario: Canvas shows last-valid state during invalid YAML edit
- **WHEN** a user introduces a YAML syntax error in the editor
- **THEN** the canvas pane (if visible) MUST continue to display the graph from the
  last syntactically valid document and MUST show a warning banner

#### Scenario: Draft is not persisted while YAML is invalid
- **WHEN** the auto-save timer fires while the YAML editor holds an invalid document
- **THEN** no draft-save HTTP request MUST be issued to the server

#### Scenario: Recovery on valid edit clears the warning banner
- **WHEN** the user corrects the YAML error so that the document is valid again
- **THEN** the warning banner MUST be dismissed and the canvas MUST update to the
  corrected graph

---

### Requirement: New console component tests follow the broken-baseline rule

The system SHALL include vitest component tests for `FlowYamlEditor` and
`FlowViewSwitcher` that pass with the Vite 6 / jsdom / `@testing-library/react` 16
setup already present in `apps/web-console/vite.config.ts::test`. Adding these tests
MUST NOT cause any previously-passing test in the suite to begin failing; the
pre-existing broken-baseline test count MUST NOT increase.

#### Scenario: FlowYamlEditor component test passes
- **WHEN** `vitest run` is executed in `apps/web-console`
- **THEN** the test `FlowYamlEditor` MUST pass and the total number of failing tests
  MUST NOT exceed the count recorded before this change

#### Scenario: FlowViewSwitcher mode switching test passes
- **WHEN** `vitest run` is executed in `apps/web-console`
- **THEN** the test asserting that clicking YAML mode renders the editor surface MUST
  pass
