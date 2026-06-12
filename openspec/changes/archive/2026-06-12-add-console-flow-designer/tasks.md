## 1. Baseline and dependency setup

- [x] 1.1 Confirm baseline: run `vitest run --reporter=json` in `apps/web-console` and record the pre-existing failing test set
- [x] 1.2 Add `@xyflow/react` to `apps/web-console/package.json` production dependencies
- [x] 1.3 Verify TypeScript resolves `@xyflow/react` types (`tsc --noEmit` clean after install)
- [x] 1.4 Import `FlowDefinition` and `TaskTypeDescriptor` types from `@falcone/internal-contracts` (available once `add-flows-dsl-schema` and `add-flows-activity-catalog` land); add stubs if not yet available

## 2. Service layer

- [x] 2.1 Create `apps/web-console/src/services/flowsApi.ts` with exports: `listFlows`, `getFlow`, `createFlowDraft`, `updateFlowDraft`, `validateFlow`, `publishFlow` — each using `requestConsoleSessionJson`
- [x] 2.2 Create `apps/web-console/src/services/taskTypeRegistryApi.ts` with export `listTaskTypes(workspaceId)` using `requestConsoleSessionJson`
- [x] 2.3 Add TypeScript return-type annotations for all exported functions matching DSL contract types

## 3. Router registration

- [x] 3.1 Add lazy import of `ConsoleFlowsPage` to `apps/web-console/src/router.tsx`
- [x] 3.2 Add lazy import of `ConsoleFlowDesignerPage` to `apps/web-console/src/router.tsx`
- [x] 3.3 Register route `/console/flows` → `ConsoleFlowsPage` inside `ProtectedRoute` + `ConsoleShellLayout`
- [x] 3.4 Register route `/console/flows/:flowId` → `ConsoleFlowDesignerPage` inside `ProtectedRoute` + `ConsoleShellLayout`

## 4. Flow list page

- [x] 4.1 Create `apps/web-console/src/pages/ConsoleFlowsPage.tsx` — calls `listFlows`, renders a table/list with name, status, last-modified, and a "New flow" button
- [x] 4.2 "New flow" action calls `createFlowDraft` and navigates to `/console/flows/:newFlowId`
- [x] 4.3 Apply `CapabilityGate` wrapping (matching pattern in `ConsoleFunctionsPage`)

## 5. Custom node components

- [x] 5.1 Create directory `apps/web-console/src/components/flows/nodes/`
- [x] 5.2 Implement `TaskNode.tsx` — displays `taskType` label, retry badge, error badge overlay from `data.validationErrors`
- [x] 5.3 Implement `BranchNode.tsx` — displays condition-arm count, renders one output handle per arm plus a default handle; error badge overlay
- [x] 5.4 Implement `ParallelNode.tsx` — displays branch count; error badge overlay
- [x] 5.5 Implement `WaitNode.tsx` — displays duration; error badge overlay
- [x] 5.6 Implement `ApprovalNode.tsx` — displays approval label; error badge overlay
- [x] 5.7 Implement `SubFlowNode.tsx` — displays `flowId` + `flowVersion`; error badge overlay
- [x] 5.8 Export a `nodeTypes` map for registration with `@xyflow/react`

## 6. Palette component

- [x] 6.1 Create `apps/web-console/src/components/flows/FlowPalette.tsx`
- [x] 6.2 Fetch task-type catalog via `listTaskTypes` on mount; display loading/error states with retry
- [x] 6.3 Render one draggable entry per `TaskTypeDescriptor` using `@xyflow/react` drag-to-canvas pattern
- [x] 6.4 Group palette entries by `category` field from the descriptor

## 7. Connection-rule enforcement

- [x] 7.1 Implement `isValidConnection` helper in `apps/web-console/src/components/flows/connectionRules.ts`
- [x] 7.2 Acyclicity check: BFS/DFS from proposed target to detect if source is reachable
- [x] 7.3 Branch-arity check: reject a second outgoing edge on a branch condition-arm handle
- [x] 7.4 Self-loop check: reject `source === target`
- [x] 7.5 Wire `isValidConnection` into the `ReactFlow` component; violations produce a Problems panel entry

## 8. Semantic validation

- [x] 8.1 Implement `validateFlowSemantics(nodes, edges): ValidationError[]` in `apps/web-console/src/components/flows/semanticValidation.ts` covering FLW-E001…FLW-E009
- [x] 8.2 Run validation in a `useMemo` keyed on nodes + edges state in `ConsoleFlowDesignerPage`
- [x] 8.3 Distribute errors to node `data.validationErrors` props during node array construction
- [x] 8.4 Aggregate all errors in a `FlowProblemsPanel` component shown below/alongside the canvas

## 9. Property panels

- [x] 9.1 Create directory `apps/web-console/src/components/flows/panels/`
- [x] 9.2 Implement `NodePropertyPanel.tsx` — dispatches to per-type panel based on selected node type
- [x] 9.3 Implement `TaskPropertyPanel.tsx` — generates fields from `TaskTypeDescriptor.inputSchema` for `string`, `number`, `boolean`, `enum` types; marks `x-falcone-expression: true` fields as expression inputs
- [x] 9.4 Implement `RetryPolicyEditor.tsx` — controlled inputs for `maxAttempts` (integer), `backoffCoefficient` (decimal), `initialInterval` (ISO 8601 duration); inline validation errors
- [x] 9.5 Implement expression field with syntax validation against FLW-E005; surface errors in Problems panel
- [x] 9.6 Property panel changes update in-memory DSL model immediately without triggering a save

## 10. Canvas layout persistence (canvasMetadata)

- [x] 10.1 Implement `readCanvasMetadata(definition): Record<string, {x: number, y: number}>` — extracts positions from `canvasMetadata.nodes`
- [x] 10.2 Implement `writeCanvasMetadata(definition, nodePositions): FlowDefinition` — merges current `@xyflow/react` node positions into `canvasMetadata.nodes`
- [x] 10.3 On flow load: inject positions from `canvasMetadata.nodes` as `initialNodes` position props; apply auto-layout when absent
- [x] 10.4 On draft save: call `writeCanvasMetadata` before passing the definition to `updateFlowDraft`

## 11. Designer page: toolbar and lifecycle

- [x] 11.1 Create `apps/web-console/src/pages/ConsoleFlowDesignerPage.tsx` — composes canvas, palette, property panel, problems panel, and toolbar
- [x] 11.2 Implement "Save draft" toolbar button: calls `updateFlowDraft`; shows "Saved" confirmation; clears unsaved-changes indicator
- [x] 11.3 Implement "Revert" toolbar button: reloads the last persisted draft from the server
- [x] 11.4 Implement "Publish" toolbar button: calls `publishFlow`; disabled when blocking validation errors exist; shows version identifier on success
- [x] 11.5 Map server 422 `nodeId`-scoped errors from `validateFlow` / `publishFlow` responses onto canvas node `data.validationErrors`
- [x] 11.6 Display flow-level (no `nodeId`) 422 errors in the Problems panel

## 12. Component tests

- [x] 12.1 Write `apps/web-console/src/__tests__/FlowGraphModel.test.tsx` — round-trip serialisation: canvas graph → DSL nodes array → canvas nodes array; assert node count and type preservation
- [x] 12.2 Write `apps/web-console/src/__tests__/FlowConnectionRules.test.ts` — unit tests for `isValidConnection`: self-loop rejected, cycle rejected, valid connection accepted, branch-arity overflow rejected
- [x] 12.3 Write `apps/web-console/src/__tests__/FlowSemanticValidation.test.ts` — unit tests for `validateFlowSemantics`: FLW-E001 duplicate IDs, FLW-E002 cycle, FLW-E003 dangling edge, clean graph produces empty list
- [x] 12.4 Confirm all new tests pass (`vitest run` → 0 new failures)
- [x] 12.5 Confirm pre-existing failing test set is unchanged (diff against baseline from task 1.1)
