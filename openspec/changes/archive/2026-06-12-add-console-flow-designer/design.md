## Context

The web console (`apps/web-console`) is a React 18 + Vite + TypeScript SPA. Its current
dependency tree (`apps/web-console/package.json`) contains no canvas or graph-editor
library; the UI toolkit is Tailwind CSS 3 + Radix UI primitives + `lucide-react` icons,
all composed through `shadcn/ui`-style component wrappers under
`apps/web-console/src/components/ui/`. Page components follow a consistent pattern
established by `ConsoleFunctionsPage` and `ConsoleKafkaPage`: stateful pages import
`requestConsoleSessionJson` from `apps/web-console/src/lib/console-session.ts`, expose
typed service helpers in `apps/web-console/src/services/`, and are registered in
`apps/web-console/src/router.tsx` either eagerly (to avoid React #426 Suspense throws)
or lazily when the bundle size warrants it. The router already uses `React.lazy` for
`ConsoleRealtimePage`, `ConsoleDocsPage`, `ConsoleSecretsPage`, and
`ConsoleSecretRotationPage`.

The DSL schema is defined by `add-flows-dsl-schema` and exported from
`@falcone/internal-contracts`. The flow control-plane API (routes, draft/publish
lifecycle, 422 semantic errors) is defined by `add-flows-control-plane-api`. The
task-type catalog endpoint is defined by `add-flows-activity-catalog`.

## Goals / Non-Goals

**Goals:**

- Add `@xyflow/react` as the canvas library; code-split the entire Flows section via
  `React.lazy` so it loads only when the user navigates to `/console/flows`.
- Build a typed service layer (`flowsApi.ts`, `taskTypeRegistryApi.ts`) that maps cleanly
  onto the flow API using the existing `requestConsoleSessionJson` helper.
- Implement one custom `@xyflow/react` node component per DSL construct, styled with the
  existing Tailwind/Radix system, accepting a `data.validationErrors` prop for badge
  overlays.
- Implement palette driven entirely by the server task-type catalog (no hardcoded types).
- Enforce DSL graph constraints (acyclicity, branch arity, handle validity) in
  `@xyflow/react`'s `isValidConnection` callback — synchronous, interaction-time only.
- Run full client-side semantic validation (`FLW-E001`…`FLW-E009`) after every graph
  change and distribute per-node errors to node components via the `data.validationErrors`
  prop.
- Map server 422 `nodeId`-scoped errors back onto canvas nodes after save/publish.
- Persist canvas positions in `canvasMetadata.nodes` on every draft save; restore on load.
- Provide `updateFlowDraft` / `publishFlow` toolbar controls with publish gated on zero
  blocking errors.

**Non-Goals:**

- YAML editor and sync — tracked in `add-console-flow-yaml-editor`.
- Live execution overlay (running/failed step highlighting) — tracked in
  `add-console-flow-monitoring`.
- Mobile or touch-optimised canvas interactions.
- Server-side changes — this change is purely console-side.

## Decisions

### D1: @xyflow/react (React Flow v12) as the canvas library

React Flow is the only production-ready node-canvas library with a React 18 API, active
maintenance, and a permissive MIT licence. Alternatives considered:

- **Cytoscape.js**: mature but imperative DOM-centric API that does not fit the React
  controlled-component model.
- **JointJS/Rappid**: commercial licence; incompatible with this open-source repo.
- **Hand-rolled SVG**: high implementation cost with no benefit over React Flow.

React Flow's `isValidConnection` callback provides the synchronous connection-validation
hook required for interaction-time constraint enforcement (D3).

### D2: Code-splitting the Flows section via React.lazy

`@xyflow/react` + its CSS adds roughly 150 kB (minified+gzip estimate). The existing
pattern for heavyweight sections — `ConsoleRealtimePage`, `ConsoleSecretsPage` — is
`React.lazy(() => import(...))`. The Flows section SHALL follow this same pattern. The
`ConsoleShellLayout` wraps children in `<Suspense>` already, so no layout changes are
needed for the loading state.

### D3: Interaction-time connection rules via isValidConnection

`@xyflow/react` exposes `isValidConnection(connection)` on the `ReactFlow` component.
Acyclicity is checked by traversing the current edges array from the proposed target node
to determine if the source is reachable (O(V+E) BFS/DFS over the in-memory graph, fast
enough for typical flow sizes of < 200 nodes). Branch-arity and handle-validity checks
are O(1) lookups on the current edges array. This approach runs synchronously during the
drag gesture and requires no server round-trip.

### D4: Client-side semantic validation on every graph change

Semantic rules `FLW-E001`…`FLW-E009` are stateless pure functions over the DSL model.
They run in a `useEffect` / `useMemo` chain triggered by any change to the nodes or edges
state. Results are stored as a `Map<nodeId, ValidationError[]>` and injected into each
node's `data.validationErrors` prop during the `@xyflow/react` nodes array construction.
This avoids storing error state separately from the graph state and keeps the node
components purely presentational.

### D5: Property panel form generation from task input JSON Schema

The `TaskTypeDescriptor.inputSchema` field is a JSON Schema object. Rather than
introducing a full JSON-Schema-to-form library (adds bundle weight and schema-coverage
risk), the initial implementation renders only the types actually required by the DSL:
`string`, `number`, `boolean`, and `enum` (select). Expression-type fields are identified
by a custom `x-falcone-expression: true` extension on the JSON Schema property. This
keeps the property panel thin while covering all present task types. A richer form library
can be added later as an additive change.

### D6: canvasMetadata written on every draft save, read on load

Positions are written as `{ x: number, y: number }` into
`canvasMetadata.nodes[nodeId]` at save time using `@xyflow/react`'s node position
accessor. On load, positions are injected into the `@xyflow/react` `initialNodes` prop.
When `canvasMetadata` is absent, a simple top-down auto-layout (vertical stacking,
configurable spacing) is applied. This satisfies the round-trip requirement without
depending on a layout engine library.

## Risks / Trade-offs

- **Bundle size regression**: `@xyflow/react` code-split mitigates this, but the Flows
  chunk is still ~150 kB. Mitigation: bundle-size assertion in CI (future task; tracked
  as open question below).
- **vitest baseline is broken on main**: New tests must be isolated so the pre-existing
  failing set does not grow. Mitigation: run `vitest run --reporter=json` before and after
  and diff the failure list.
- **Task-type catalog shape unknown until #360 lands**: The `TaskTypeDescriptor` type is
  defined here by contract; mismatches will surface as TypeScript errors at integration
  time. Mitigation: define the type in `@falcone/internal-contracts` as part of
  `add-flows-activity-catalog`; import it here.
- **React Flow peer-dependency on React 18**: `@xyflow/react` v12 requires React ≥ 18.
  `apps/web-console/package.json` already pins `react: ^18.3.1`. No conflict.

## Migration Plan

1. Add `@xyflow/react` to `apps/web-console/package.json` dependencies.
2. Create service modules and page stubs (routes registered but canvas empty).
3. Implement custom node components and palette (palette hard-coded initially, then
   switched to server catalog once the catalog endpoint is available).
4. Wire `isValidConnection` and semantic validation.
5. Implement property panels.
6. Implement save/publish toolbar with `canvasMetadata` persistence.
7. Write Vitest component tests; confirm pre-existing failing set is unchanged.

No backend migration steps. Rollback: revert the `router.tsx` lazy-import addition and
remove the new files — no persistent state is created until a user saves a draft.

## Implementation Deviations (recorded during apply)

- **DV1 — package name**: the contract package is published as
  `@in-falcone/internal-contracts` (not `@falcone/internal-contracts` as written in the
  prose above). The console imports the shared validator + fixtures from that name. The
  designer imports `validateFlowDefinition` and `FLOW_VALIDATION_ERROR_CODES` directly from
  `services/internal-contracts/src/flow-definition-validator.mjs` (plain ESM + `cel-js`,
  bundler-friendly) so client-side validation reuses the IDENTICAL rule set as the server.

- **DV2 — task-type catalog endpoint**: `add-flows-activity-catalog` (#360) shipped the
  task-type *registry* (`services/workflow-worker/src/activities/catalog.mjs` with
  `{ activity, inputSchema, outputSchema }`) and a Temporal-free name list
  (`catalog-names.mjs :: TASK_TYPE_NAMES`), but NOT a public HTTP endpoint serving the
  descriptors. The worker's per-activity `*InputSchema` exports are Temporal-coupled
  (they import `./limits.mjs` / `./errors.mjs`, which import `@temporalio/activity`), so the
  Temporal-free control-plane cannot import them. This change therefore adds, minimally:
  - `apps/control-plane/src/runtime/flow-task-types.mjs` — a Temporal-free descriptor catalog
    (`{ id, label, category, inputSchema }`) whose ids are cross-checked at build time against
    `TASK_TYPE_NAMES` (fail-closed on drift, mirroring `catalog.mjs`'s self-check), with the
    `inputSchema` objects mirroring the worker exports verbatim and `x-falcone-expression`
    annotations per D5.
  - `GET /v1/flows/workspaces/{workspaceId}/task-types` in `flow-executor.mjs`
    (`list_task_types` operation) + `server.mjs` (registered only when `flowExecutor` is wired)
    + the gateway allow-list (`public-route-catalog.json`, `structural_admin`).
  The console `taskTypeRegistryApi.ts :: listTaskTypes(workspaceId)` calls this route.

- **DV3 — `ApiError.errors` passthrough**: the console HTTP layer's `normalizeApiError`
  (`apps/web-console/src/lib/http.ts`) previously stripped the server's top-level `errors`
  array from 4xx envelopes. An additive optional `errors` field is now preserved so the flows
  service module can map 422 `FLOW_VALIDATION_FAILED` node-scoped errors
  (`[{ code, nodeId, message }]`) back onto canvas nodes. This is additive and does not change
  any existing field.

- **DV4 — publish endpoint shape**: the #361 flow API has no `POST .../publish`; publishing a
  draft is `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` (validates then
  pins a new immutable version → `{ flowId, version, createdAt }`). `validateFlow` is
  `POST .../flows/{flowId}/validate`. The service module + designer use these real shapes.

- **DV5 — shared validator wiring**: the console consumes the shared validator through a
  real workspace dependency (`@in-falcone/internal-contracts: workspace:*` in
  `apps/web-console/package.json`) plus a local ambient declaration
  (`src/types/flow-definition-validator.d.ts`) typing only the consumed exports, since the
  contracts package ships untyped `.mjs`. `cel-js` resolves transitively.

- **DV6 — extra designer semantics beyond the spec minimum**:
  - a `sequence` custom node is registered in `nodeTypes` (the DSL has 7 constructs; the
    spec lists 6 palette constructs, but loaded definitions may contain sequences);
  - connection rules also enforce *single-next arity* (a second outgoing edge from
    task/wait/approval/sub-flow is rejected) because the DSL has a single `next` field and
    a second edge would otherwise be silently dropped on save projection;
  - the publish action saves the draft first (the #361 publish pins the PERSISTED draft),
    then calls `POST .../versions`.

- **DV7 — capability gate + back-end contract pin**: the Flows pages are wrapped in
  `CapabilityGate capability="workflows" mode="disable"` (mirroring `functions_public` on
  `ConsoleFunctionsPage`; capability keys are plan-defined). The DV2 task-types endpoint
  is pinned by a black-box suite `tests/blackbox/flows-task-types.test.mjs`
  (bbx-flows-task-types-01…04: 200 + items shape, descriptor contract, 401 without
  identity, 404 without flowExecutor).

## Open Questions

- **Q1**: Should `ConsoleFlowsPage` (list) also be lazy-loaded, or only
  `ConsoleFlowDesignerPage`? Given the list page has no canvas dependency, eager import
  may be preferable to avoid a loading state on the nav link click.
  → Resolved: BOTH are lazy. The list page navigates straight into the designer, the two
  routes share the flows service chunk, and the route registration uses `router.tsx`'s
  existing lazy pattern; the list chunk is 3.65 kB so the loading state is negligible.
- **Q2**: Is a CI bundle-size gate needed for this change, or is it deferred to a
  separate `add-flows-bundle-audit` change?
  → Deferred (not part of this change). Measured: designer chunk 356.00 kB
  (gzip 110.01 kB) + 15.87 kB CSS, fully code-split — `@xyflow` does not appear in the
  initial `index` chunk.
- **Q3**: What auto-layout algorithm should be used when `canvasMetadata` is absent —
  simple vertical stack, or dagre (adds a dependency)? Dagre is more readable for
  branching graphs but adds ~30 kB. Decision deferred to implementation.
  → Resolved: deterministic vertical stack (`flowGraphModel.ts::autoLayout`), no new
  dependency.
