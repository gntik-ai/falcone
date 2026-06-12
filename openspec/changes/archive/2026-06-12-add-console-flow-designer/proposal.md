## Why

The web console (`apps/web-console`: React 18 + Vite + TypeScript + Tailwind/Radix,
`apps/web-console/package.json`) has no canvas tooling — zero canvas or graph-editor
library in its dependency tree today. Tenants composing Temporal-backed workflows have
no visual surface to author, inspect, or publish flow definitions; they must hand-edit
raw DSL, which is error-prone and inaccessible. This change adds the node-based visual
designer (canvas + palette + property panels + client-side validation) as the primary
authoring surface for the `workflows` capability, unblocking the YAML-sync sibling
(`add-console-flow-yaml-editor`) and the monitoring overlay (`add-console-flow-monitoring`).

## What Changes

- New React Router v6 route family `console/flows` and `console/flows/:flowId` added to
  `apps/web-console/src/router.tsx` (matching the lazy-import pattern already used for
  `ConsoleRealtimePage` and `ConsoleSecretsPage`).
- New service module `apps/web-console/src/services/flowsApi.ts` — typed wrappers over
  the `#361` flow API using `requestConsoleSessionJson` (same pattern as
  `apps/web-console/src/services/functionsApi.ts`).
- New service module `apps/web-console/src/services/taskTypeRegistryApi.ts` — fetches
  the server task-type catalog dynamically (driven by `#360`).
- New page `apps/web-console/src/pages/ConsoleFlowsPage.tsx` (list + create) and
  `apps/web-console/src/pages/ConsoleFlowDesignerPage.tsx` (canvas editor).
- New dependency `@xyflow/react` (React Flow v12) added to `package.json`; the Flows
  section is code-split via `React.lazy` so the canvas bundle does not inflate the
  initial shell load.
- Custom node components per DSL construct (`task`, `branch`, `parallel`, `wait`,
  `approval`, `sub-flow`) under `apps/web-console/src/components/flows/nodes/`.
- Per-node property panel components under
  `apps/web-console/src/components/flows/panels/` — forms generated from task input
  JSON Schemas (from the task-type catalog), expression fields, and retry-policy editor.
- Client-side semantic validation (`FLW-E001`…`FLW-E009`, defined in `add-flows-dsl-schema`)
  runs on every graph change; node-scoped errors are rendered as badge overlays on canvas
  nodes and listed in a Problems panel.
- Server 422 errors carrying `nodeId` fields are mapped back onto the corresponding canvas
  nodes on save/publish failure.
- Canvas layout is written into and read from the DSL `canvasMetadata` section on every
  save so positions survive round-trips.
- Vitest component tests for graph↔DSL-model mapping and connection-rule enforcement
  added under `apps/web-console/src/__tests__/`. The web-console vitest baseline is broken
  on main; verification contract is **new tests pass + failing set unchanged**.

## Capabilities

### New Capabilities

(none — the `workflows` capability is already introduced by `add-flows-dsl-schema`)

### Modified Capabilities

- `workflows`: Add console visual designer requirements — canvas routes, service layer,
  node components, palette, property panels, connection-rule enforcement, client-side
  semantic validation, canvas-metadata persistence, draft/publish lifecycle via the flow
  API, and bundle-split strategy.

## Impact

- `apps/web-console/package.json`: new production dependency `@xyflow/react`.
- `apps/web-console/src/router.tsx`: two new lazy routes under `/console/flows`.
- `apps/web-console/src/services/`: two new modules (`flowsApi.ts`,
  `taskTypeRegistryApi.ts`).
- `apps/web-console/src/pages/`: two new pages (`ConsoleFlowsPage.tsx`,
  `ConsoleFlowDesignerPage.tsx`).
- `apps/web-console/src/components/flows/`: new subdirectory with node components,
  property panels, and palette.
- `apps/web-console/src/__tests__/`: new Vitest component test files.
- **Depends on:** `add-flows-dsl-schema` (#358), `add-flows-control-plane-api` (#361).
- **Blocks:** `add-console-flow-yaml-editor` (#364), `add-console-flow-monitoring` (#366),
  `add-flows-triggers` (#367).
- No backend service changes; purely console-side.
