## 1. Dependencies and Build Configuration

- [x] 1.1 Add `monaco-editor`, `monaco-yaml`, and `yaml` to `apps/web-console/package.json` dependencies
- [x] 1.2 Extend `apps/web-console/vite.config.ts` with `build.rollupOptions.output.manualChunks` to isolate Monaco into a `monaco-chunk` chunk
- [x] 1.3 Verify that `vite build` produces a `monaco-chunk` output file and that it is NOT imported by the main entry chunk statically
      (DEVIATION: also pin Vite's `__vitePreload` helper to its own `vite-helpers` chunk — without
      this, Rollup co-located the helper in monaco-chunk, which dragged the 1 MB+ chunk into every
      lazy route's preload graph and into index.html. With the pin, the index entry chunk and
      index.html no longer reference monaco-chunk; it is reachable ONLY via FlowYamlEditor's
      dynamic import.)
- [x] 1.4 Record the gzipped size of `monaco-chunk` in a comment in `vite.config.ts` for future reference (bundle impact tracking)

## 2. YAML Serialiser Library

- [x] 2.1 Create `apps/web-console/src/lib/flows/yaml-serialiser.ts` implementing deterministic graph→YAML serialisation with schema-property key order and `canvasMetadata` last
      (Key order is derived from the versioned JSON Schema's `properties` insertion order — top
      level + per-node-type definitions — then alphabetical for non-schema keys; canvasMetadata
      is always forced last.)
- [x] 2.2 Document the comment-normalisation policy in a code comment at the serialiser entry point (comments preserved during YAML-only edits; discarded on canvas round-trip)
- [x] 2.3 Create `apps/web-console/src/lib/flows/yaml-round-trip.ts` implementing YAML→graph deserialisation using the `yaml` CST-aware library
- [x] 2.4 Write property-based round-trip tests in `apps/web-console/src/__tests__/FlowYamlRoundTrip.test.ts` covering all five fixtures (`minimal-3-node`, `branch-retry`, `parallel-fan-out`, `human-approval`, `sub-flow-ref`) from `services/internal-contracts/src/fixtures/flows/`
- [x] 2.5 Assert `canvasMetadata` survives round-trip independently in the property-based test
- [x] 2.6 Verify all round-trip tests pass with `vitest run` without growing the broken-baseline failing count

## 3. Semantic Validation Worker

- [x] 3.1 Create `apps/web-console/src/lib/flows/semantic-worker.ts` as a Vite worker module implementing FLW-E001…FLW-E009 semantic rules client-side
      (The rule logic lives in the shared validator — `@in-falcone/internal-contracts` — and is
      wrapped by a framework-free core `semantic-validation-core.ts`; the worker is a thin
      transport around it, so the same rules/messages as the server are used, never re-implemented.)
- [x] 3.2 Wire the worker using `new Worker(new URL('./semantic-worker.ts', import.meta.url), {type:'module'})` so Vite can resolve it at build time
      (Wired from FlowYamlEditor with the `@/lib/flows/semantic-worker.ts` URL; falls back to
      synchronous in-thread validation when Worker is unavailable, e.g. jsdom tests.)
- [x] 3.3 Ensure the worker returns `{code: string, line: number}[]` errors via `postMessage`
      (Returns `FlowMarker[]` = `{ code, message, nodeId, line, column, severity }`, line-anchored
      to each node's `id:` line via the YAML CST in `semantic-markers.ts`.)

## 4. FlowYamlEditor Component

- [x] 4.1 Create `apps/web-console/src/components/flows/FlowYamlEditor.tsx` using `React.lazy` + `Suspense` for the Monaco dynamic import
      (The Monaco host is split into `MonacoYamlSurface.tsx`, lazily imported by FlowYamlEditor;
      that is the React.lazy boundary that code-splits Monaco out of the main bundle.)
- [x] 4.2 Configure `monaco-yaml` language service with the `flowDefinitionSchema` imported from `@falcone/internal-contracts`, inlined as a JSON object (not a URI) to avoid CORS issues
      (DEVIATION: the package is `@in-falcone/internal-contracts`; the schema is imported DIRECTLY
      from `@in-falcone/internal-contracts/src/flow-definition.json` with `{ type: 'json' }`, NOT
      via the barrel `index.mjs` — the barrel runs `readFileSync(new URL(...))` at import time which
      breaks under the bundler/jsdom. The schema object is passed inline to `configureMonacoYaml`.)
- [x] 4.3 Integrate the semantic validation worker: on document change, post the YAML to the worker and update Monaco markers from the response
      (Markers are set on the model under the `flow-semantic` owner so they coexist with
      monaco-yaml's structural JSON-Schema diagnostics.)
- [x] 4.4 Implement the draft-save guard: check `isDocumentValid` ref before dispatching any `PATCH /flows/:id` auto-save call
      (Implemented two ways: the editor reports `onValidityChange({ parseable, valid, markers })`,
      and the host `saveDraft` resolves the definition from the YAML buffer and refuses to call
      `updateFlowDraft` — PATCH /flows/:id — when the YAML is unparseable. See ConsoleFlowDesignerPage.)
- [x] 4.5 Write `apps/web-console/src/__tests__/FlowYamlEditor.test.tsx` mocking Monaco and the semantic worker; assert editor mounts, schema wiring call is made, and invalid YAML suppresses the save dispatch
      (Monaco is mocked via the MonacoYamlSurface lazy module; the worker is absent in jsdom so the
      synchronous path runs. Tests assert mount, clean→valid, FLW-E001→marker+valid=false, syntax
      error→parseable=false/valid=false, and onChange propagation.)

## 5. FlowViewSwitcher Component

- [x] 5.1 Create `apps/web-console/src/components/flows/FlowViewSwitcher.tsx` with three mode buttons: canvas, YAML, side-by-side
- [x] 5.2 Implement dirty-state tracking per view; on YAML→canvas switch, flush YAML edits into the graph model before rendering canvas
      (Logic factored into a pure reducer `lib/flows/view-sync.ts` so it is unit-testable; the
      switcher and the designer page both drive it.)
- [x] 5.3 Implement conflict guard: if YAML is syntactically invalid when the user clicks canvas or side-by-side, block the switch and display an inline error banner
- [x] 5.4 Implement graceful degradation: canvas pane shows last-valid graph with warning banner while YAML holds invalid content; warning banner clears when YAML becomes valid again
- [x] 5.5 Write `apps/web-console/src/__tests__/FlowViewSwitcher.test.tsx`: test default mode is canvas, clicking YAML renders editor, side-by-side renders both panes, invalid YAML blocks switch
- [x] 5.6 Verify all new component tests pass with `vitest run` and the broken-baseline failing count has not increased

## 6. Integration into Flows Route

- [x] 6.1 Replace the canvas-only render in the Flows detail route (from `add-console-flow-designer`) with `FlowViewSwitcher` wrapping both the canvas component and `FlowYamlEditor`
      (DEVIATION: the designer page `ConsoleFlowDesignerPage` owns the canvas state AND the
      Save/Revert/Publish toolbar, so wrapping it inside an opaque `FlowViewSwitcher` would have
      required hoisting all of that. Instead the view-mode switcher (canvas | YAML | side-by-side)
      is integrated INTO the designer page header using the SAME primitives — the view-sync flush
      semantics, the serialiser, and the FlowYamlEditor — so the YAML view shares the designer's
      canonical document and publish path. `FlowViewSwitcher` is still delivered as a standalone,
      fully-tested reusable component per the spec requirement.)
- [x] 6.2 Confirm the published flow path (submit button) remains unchanged: it calls the server-side validation endpoint from `add-flows-control-plane-api` regardless of which view is active
      (Publish still calls `saveDraft` then `publishFlow` → POST .../versions; server validation
      stays authoritative. The only addition is the client-side YAML-invalid guard on saveDraft.)

## 7. Final Verification

- [x] 7.1 Run `vitest run` in `apps/web-console` and confirm all new tests pass and no previously-passing test is now failing
      (Baseline before: 34 failed / 493 passed (527). After: 34 failed / 529 passed (563) — same
      3 pre-existing failing files (ConsoleShellLayout, console-context, ConsoleMembersPage), +36
      new passing tests, zero regressions.)
- [x] 7.2 Run `vite build` in `apps/web-console` and confirm the Monaco chunk is present and the main entry chunk size delta is within the recorded budget
      (monaco-chunk ~1,102 kB gzip present and lazy; index entry ~175 kB gzip, unchanged, no monaco
      static import / preload.)
- [x] 7.3 Run `openspec validate add-console-flow-yaml-editor --strict` and confirm zero errors
