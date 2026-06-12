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

## Open Questions

- **Q1**: Should `ConsoleFlowsPage` (list) also be lazy-loaded, or only
  `ConsoleFlowDesignerPage`? Given the list page has no canvas dependency, eager import
  may be preferable to avoid a loading state on the nav link click.
- **Q2**: Is a CI bundle-size gate needed for this change, or is it deferred to a
  separate `add-flows-bundle-audit` change?
- **Q3**: What auto-layout algorithm should be used when `canvasMetadata` is absent —
  simple vertical stack, or dagre (adds a dependency)? Dagre is more readable for
  branching graphs but adds ~30 kB. Decision deferred to implementation.
