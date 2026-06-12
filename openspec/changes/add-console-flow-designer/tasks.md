## 1. Baseline and dependency setup

- [ ] 1.1 Confirm baseline: run `vitest run --reporter=json` in `apps/web-console` and record the pre-existing failing test set
- [ ] 1.2 Add `@xyflow/react` to `apps/web-console/package.json` production dependencies
- [ ] 1.3 Verify TypeScript resolves `@xyflow/react` types (`tsc --noEmit` clean after install)
- [ ] 1.4 Import `FlowDefinition` and `TaskTypeDescriptor` types from `@falcone/internal-contracts` (available once `add-flows-dsl-schema` and `add-flows-activity-catalog` land); add stubs if not yet available

## 2. Service layer

- [ ] 2.1 Create `apps/web-console/src/services/flowsApi.ts` with exports: `listFlows`, `getFlow`, `createFlowDraft`, `updateFlowDraft`, `validateFlow`, `publishFlow` — each using `requestConsoleSessionJson`
- [ ] 2.2 Create `apps/web-console/src/services/taskTypeRegistryApi.ts` with export `listTaskTypes(workspaceId)` using `requestConsoleSessionJson`
- [ ] 2.3 Add TypeScript return-type annotations for all exported functions matching DSL contract types

## 3. Router registration

- [ ] 3.1 Add lazy import of `ConsoleFlowsPage` to `apps/web-console/src/router.tsx`
- [ ] 3.2 Add lazy import of `ConsoleFlowDesignerPage` to `apps/web-console/src/router.tsx`
- [ ] 3.3 Register route `/console/flows` → `ConsoleFlowsPage` inside `ProtectedRoute` + `ConsoleShellLayout`
- [ ] 3.4 Register route `/console/flows/:flowId` → `ConsoleFlowDesignerPage` inside `ProtectedRoute` + `ConsoleShellLayout`

## 4. Flow list page

- [ ] 4.1 Create `apps/web-console/src/pages/ConsoleFlowsPage.tsx` — calls `listFlows`, renders a table/list with name, status, last-modified, and a "New flow" button
- [ ] 4.2 "New flow" action calls `createFlowDraft` and navigates to `/console/flows/:newFlowId`
- [ ] 4.3 Apply `CapabilityGate` wrapping (matching pattern in `ConsoleFunctionsPage`)

## 5. Custom node components

- [ ] 5.1 Create directory `apps/web-console/src/components/flows/nodes/`
- [ ] 5.2 Implement `TaskNode.tsx` — displays `taskType` label, retry badge, error badge overlay from `data.validationErrors`
- [ ] 5.3 Implement `BranchNode.tsx` — displays condition-arm count, renders one output handle per arm plus a default handle; error badge overlay
- [ ] 5.4 Implement `ParallelNode.tsx` — displays branch count; error badge overlay
- [ ] 5.5 Implement `WaitNode.tsx` — displays duration; error badge overlay
- [ ] 5.6 Implement `ApprovalNode.tsx` — displays approval label; error badge overlay
- [ ] 5.7 Implement `SubFlowNode.tsx` — displays `flowId` + `flowVersion`; error badge overlay
- [ ] 5.8 Export a `nodeTypes` map for registration with `@xyflow/react`

## 6. Palette component

- [ ] 6.1 Create `apps/web-console/src/components/flows/FlowPalette.tsx`
- [ ] 6.2 Fetch task-type catalog via `listTaskTypes` on mount; display loading/error states with retry
- [ ] 6.3 Render one draggable entry per `TaskTypeDescriptor` using `@xyflow/react` drag-to-canvas pattern
- [ ] 6.4 Group palette entries by `category` field from the descriptor

## 7. Connection-rule enforcement

- [ ] 7.1 Implement `isValidConnection` helper in `apps/web-console/src/components/flows/connectionRules.ts`
- [ ] 7.2 Acyclicity check: BFS/DFS from proposed target to detect if source is reachable
- [ ] 7.3 Branch-arity check: reject a second outgoing edge on a branch condition-arm handle
- [ ] 7.4 Self-loop check: reject `source === target`
- [ ] 7.5 Wire `isValidConnection` into the `ReactFlow` component; violations produce a Problems panel entry

## 8. Semantic validation

- [ ] 8.1 Implement `validateFlowSemantics(nodes, edges): ValidationError[]` in `apps/web-console/src/components/flows/semanticValidation.ts` covering FLW-E001…FLW-E009
- [ ] 8.2 Run validation in a `useMemo` keyed on nodes + edges state in `ConsoleFlowDesignerPage`
- [ ] 8.3 Distribute errors to node `data.validationErrors` props during node array construction
- [ ] 8.4 Aggregate all errors in a `FlowProblemsPanel` component shown below/alongside the canvas

## 9. Property panels

- [ ] 9.1 Create directory `apps/web-console/src/components/flows/panels/`
- [ ] 9.2 Implement `NodePropertyPanel.tsx` — dispatches to per-type panel based on selected node type
- [ ] 9.3 Implement `TaskPropertyPanel.tsx` — generates fields from `TaskTypeDescriptor.inputSchema` for `string`, `number`, `boolean`, `enum` types; marks `x-falcone-expression: true` fields as expression inputs
- [ ] 9.4 Implement `RetryPolicyEditor.tsx` — controlled inputs for `maxAttempts` (integer), `backoffCoefficient` (decimal), `initialInterval` (ISO 8601 duration); inline validation errors
- [ ] 9.5 Implement expression field with syntax validation against FLW-E005; surface errors in Problems panel
- [ ] 9.6 Property panel changes update in-memory DSL model immediately without triggering a save

## 10. Canvas layout persistence (canvasMetadata)

- [ ] 10.1 Implement `readCanvasMetadata(definition): Record<string, {x: number, y: number}>` — extracts positions from `canvasMetadata.nodes`
- [ ] 10.2 Implement `writeCanvasMetadata(definition, nodePositions): FlowDefinition` — merges current `@xyflow/react` node positions into `canvasMetadata.nodes`
- [ ] 10.3 On flow load: inject positions from `canvasMetadata.nodes` as `initialNodes` position props; apply auto-layout when absent
- [ ] 10.4 On draft save: call `writeCanvasMetadata` before passing the definition to `updateFlowDraft`

## 11. Designer page: toolbar and lifecycle

- [ ] 11.1 Create `apps/web-console/src/pages/ConsoleFlowDesignerPage.tsx` — composes canvas, palette, property panel, problems panel, and toolbar
- [ ] 11.2 Implement "Save draft" toolbar button: calls `updateFlowDraft`; shows "Saved" confirmation; clears unsaved-changes indicator
- [ ] 11.3 Implement "Revert" toolbar button: reloads the last persisted draft from the server
- [ ] 11.4 Implement "Publish" toolbar button: calls `publishFlow`; disabled when blocking validation errors exist; shows version identifier on success
- [ ] 11.5 Map server 422 `nodeId`-scoped errors from `validateFlow` / `publishFlow` responses onto canvas node `data.validationErrors`
- [ ] 11.6 Display flow-level (no `nodeId`) 422 errors in the Problems panel

## 12. Component tests

- [ ] 12.1 Write `apps/web-console/src/__tests__/FlowGraphModel.test.tsx` — round-trip serialisation: canvas graph → DSL nodes array → canvas nodes array; assert node count and type preservation
- [ ] 12.2 Write `apps/web-console/src/__tests__/FlowConnectionRules.test.ts` — unit tests for `isValidConnection`: self-loop rejected, cycle rejected, valid connection accepted, branch-arity overflow rejected
- [ ] 12.3 Write `apps/web-console/src/__tests__/FlowSemanticValidation.test.ts` — unit tests for `validateFlowSemantics`: FLW-E001 duplicate IDs, FLW-E002 cycle, FLW-E003 dangling edge, clean graph produces empty list
- [ ] 12.4 Confirm all new tests pass (`vitest run` → 0 new failures)
- [ ] 12.5 Confirm pre-existing failing test set is unchanged (diff against baseline from task 1.1)
