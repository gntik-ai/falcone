## 1. Dependencies and Build Configuration

- [ ] 1.1 Add `monaco-editor`, `monaco-yaml`, and `yaml` to `apps/web-console/package.json` dependencies
- [ ] 1.2 Extend `apps/web-console/vite.config.ts` with `build.rollupOptions.output.manualChunks` to isolate Monaco into a `monaco-chunk` chunk
- [ ] 1.3 Verify that `vite build` produces a `monaco-chunk` output file and that it is NOT imported by the main entry chunk statically
- [ ] 1.4 Record the gzipped size of `monaco-chunk` in a comment in `vite.config.ts` for future reference (bundle impact tracking)

## 2. YAML Serialiser Library

- [ ] 2.1 Create `apps/web-console/src/lib/flows/yaml-serialiser.ts` implementing deterministic graph→YAML serialisation with schema-property key order and `canvasMetadata` last
- [ ] 2.2 Document the comment-normalisation policy in a code comment at the serialiser entry point (comments preserved during YAML-only edits; discarded on canvas round-trip)
- [ ] 2.3 Create `apps/web-console/src/lib/flows/yaml-round-trip.ts` implementing YAML→graph deserialisation using the `yaml` CST-aware library
- [ ] 2.4 Write property-based round-trip tests in `apps/web-console/src/__tests__/FlowYamlRoundTrip.test.ts` covering all five fixtures (`minimal-3-node`, `branch-retry`, `parallel-fan-out`, `human-approval`, `sub-flow-ref`) from `services/internal-contracts/src/fixtures/flows/`
- [ ] 2.5 Assert `canvasMetadata` survives round-trip independently in the property-based test
- [ ] 2.6 Verify all round-trip tests pass with `vitest run` without growing the broken-baseline failing count

## 3. Semantic Validation Worker

- [ ] 3.1 Create `apps/web-console/src/lib/flows/semantic-worker.ts` as a Vite worker module implementing FLW-E001…FLW-E009 semantic rules client-side
- [ ] 3.2 Wire the worker using `new Worker(new URL('./semantic-worker.ts', import.meta.url), {type:'module'})` so Vite can resolve it at build time
- [ ] 3.3 Ensure the worker returns `{code: string, line: number}[]` errors via `postMessage`

## 4. FlowYamlEditor Component

- [ ] 4.1 Create `apps/web-console/src/components/flows/FlowYamlEditor.tsx` using `React.lazy` + `Suspense` for the Monaco dynamic import
- [ ] 4.2 Configure `monaco-yaml` language service with the `flowDefinitionSchema` imported from `@falcone/internal-contracts`, inlined as a JSON object (not a URI) to avoid CORS issues
- [ ] 4.3 Integrate the semantic validation worker: on document change, post the YAML to the worker and update Monaco markers from the response
- [ ] 4.4 Implement the draft-save guard: check `isDocumentValid` ref before dispatching any `PATCH /flows/:id` auto-save call
- [ ] 4.5 Write `apps/web-console/src/__tests__/FlowYamlEditor.test.tsx` mocking Monaco and the semantic worker; assert editor mounts, schema wiring call is made, and invalid YAML suppresses the save dispatch

## 5. FlowViewSwitcher Component

- [ ] 5.1 Create `apps/web-console/src/components/flows/FlowViewSwitcher.tsx` with three mode buttons: canvas, YAML, side-by-side
- [ ] 5.2 Implement dirty-state tracking per view; on YAML→canvas switch, flush YAML edits into the graph model before rendering canvas
- [ ] 5.3 Implement conflict guard: if YAML is syntactically invalid when the user clicks canvas or side-by-side, block the switch and display an inline error banner
- [ ] 5.4 Implement graceful degradation: canvas pane shows last-valid graph with warning banner while YAML holds invalid content; warning banner clears when YAML becomes valid again
- [ ] 5.5 Write `apps/web-console/src/__tests__/FlowViewSwitcher.test.tsx`: test default mode is canvas, clicking YAML renders editor, side-by-side renders both panes, invalid YAML blocks switch
- [ ] 5.6 Verify all new component tests pass with `vitest run` and the broken-baseline failing count has not increased

## 6. Integration into Flows Route

- [ ] 6.1 Replace the canvas-only render in the Flows detail route (from `add-console-flow-designer`) with `FlowViewSwitcher` wrapping both the canvas component and `FlowYamlEditor`
- [ ] 6.2 Confirm the published flow path (submit button) remains unchanged: it calls the server-side validation endpoint from `add-flows-control-plane-api` regardless of which view is active

## 7. Final Verification

- [ ] 7.1 Run `vitest run` in `apps/web-console` and confirm all new tests pass and no previously-passing test is now failing
- [ ] 7.2 Run `vite build` in `apps/web-console` and confirm the Monaco chunk is present and the main entry chunk size delta is within the recorded budget
- [ ] 7.3 Run `openspec validate add-console-flow-yaml-editor --strict` and confirm zero errors
