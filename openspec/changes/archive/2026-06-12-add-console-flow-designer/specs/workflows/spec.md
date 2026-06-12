## ADDED Requirements

### Requirement: Flows section is reachable via dedicated console routes

The system SHALL register two lazy React Router v6 routes under `/console/flows` in
`apps/web-console/src/router.tsx`: a list route (`/console/flows`) rendered by
`ConsoleFlowsPage` and a designer route (`/console/flows/:flowId`) rendered by
`ConsoleFlowDesignerPage`. Both routes SHALL be wrapped in `ProtectedRoute` (matching
the pattern at `apps/web-console/src/router.tsx::RequireSuperadminRoute` and the lazy
imports of `ConsoleRealtimePage`). The Flows section bundle SHALL be code-split via
`React.lazy` so the `@xyflow/react` canvas library is not included in the initial shell
chunk.

#### Scenario: Navigating to /console/flows renders the flow list page
- **WHEN** an authenticated console user navigates to `/console/flows`
- **THEN** the system SHALL render `ConsoleFlowsPage` listing available flows for the active tenant
- **THEN** the `@xyflow/react` canvas bundle SHALL NOT have been loaded as part of the initial shell chunk

#### Scenario: Navigating to /console/flows/:flowId renders the designer
- **WHEN** an authenticated console user navigates to `/console/flows/some-flow-id`
- **THEN** the system SHALL render `ConsoleFlowDesignerPage` with the canvas editor for that flow
- **THEN** the route SHALL be protected and redirect to login when no valid session exists

#### Scenario: Unauthenticated access is rejected
- **WHEN** a request reaches `/console/flows` without a valid console session
- **THEN** the system SHALL redirect the user to `/login` via `ProtectedRoute`

---

### Requirement: Flow API service module wraps the control-plane flow endpoints

The system SHALL provide `apps/web-console/src/services/flowsApi.ts` exporting typed
helper functions that call the flow API (introduced by `add-flows-control-plane-api`)
using `requestConsoleSessionJson` from `apps/web-console/src/lib/console-session.ts`.
The module SHALL export at minimum: `listFlows`, `getFlow`, `createFlowDraft`,
`updateFlowDraft`, `validateFlow`, and `publishFlow`. Each function SHALL carry
TypeScript return-type annotations matching the DSL schema types from
`@falcone/internal-contracts`.

#### Scenario: listFlows returns tenant-scoped flow list
- **WHEN** `listFlows(tenantId, workspaceId)` is called with a valid tenant context
- **THEN** it SHALL call `GET /v1/flows/workspaces/{workspaceId}/flows` via `requestConsoleSessionJson`
- **THEN** it SHALL return a typed `{ items: FlowSummary[] }` result

#### Scenario: publishFlow calls the publish endpoint
- **WHEN** `publishFlow(flowId)` is called
- **THEN** it SHALL call `POST /v1/flows/{flowId}/publish` via `requestConsoleSessionJson`
- **THEN** it SHALL return an accepted/published status response

#### Scenario: validateFlow surfaces 422 errors with node IDs
- **WHEN** `validateFlow(flowId, definition)` receives a 422 response from the server
- **THEN** the rejected Promise SHALL carry an error object whose `body.errors` array includes entries with `nodeId` fields that can be mapped onto canvas nodes

---

### Requirement: Task-type registry service module provides dynamic palette data

The system SHALL provide `apps/web-console/src/services/taskTypeRegistryApi.ts` exporting
a `listTaskTypes(workspaceId)` function that fetches the server task-type catalog (from
`add-flows-activity-catalog` / `#360`). The function SHALL return a typed array of
`TaskTypeDescriptor` objects, each carrying at minimum `id`, `label`, `inputSchema`
(JSON Schema object for the property panel), and `category`. The palette component SHALL
call this function on mount and SHALL NOT hard-code task types.

#### Scenario: Palette renders task types from the server catalog
- **WHEN** `ConsoleFlowDesignerPage` mounts and the task-type catalog request succeeds
- **THEN** the palette SHALL display one draggable entry per `TaskTypeDescriptor` returned
- **THEN** no task type SHALL be statically coded in the palette component

#### Scenario: Palette gracefully handles catalog fetch failure
- **WHEN** the task-type catalog request fails (network error or 5xx)
- **THEN** the palette SHALL display an error state with a retry affordance
- **THEN** the canvas MUST still render existing nodes from the loaded flow definition

---

### Requirement: Canvas renders DSL nodes as typed custom node components

The system SHALL implement a custom `@xyflow/react` node type for each DSL construct:
`task`, `branch`, `parallel`, `wait`, `approval`, and `sub-flow`. Each node component
SHALL be styled using the existing Tailwind/Radix design system (using class names from
`apps/web-console/src/styles/globals.css` and `shadcn/ui` primitives already present in
`apps/web-console/src/components/ui/`). Node components SHALL accept a
`data.validationErrors` prop of type `ValidationError[]` and SHALL render an error badge
overlay when the array is non-empty.

#### Scenario: Task node displays task type label and retry badge
- **WHEN** a `task` node is rendered with `data.taskType = "send-email"` and `data.retryPolicy.maxAttempts = 3`
- **THEN** the node component SHALL display the task type label
- **THEN** the node component SHALL display a retry-count badge

#### Scenario: Node with validation errors shows an error badge
- **WHEN** a node receives a non-empty `data.validationErrors` prop (e.g. FLW-E006 for unknown taskType)
- **THEN** the node component SHALL render a visible error badge indicator
- **THEN** the error count SHALL be displayed on the badge

#### Scenario: Branch node renders correct number of output handles
- **WHEN** a `branch` node has two condition arms defined
- **THEN** the node component SHALL render exactly two labelled output handles plus one default handle

---

### Requirement: Connection rules enforce DSL graph semantics at interaction time

The system SHALL configure `@xyflow/react` connection validation callbacks to enforce
DSL graph rules before an edge is committed. The rules enforced at connection time SHALL
include: acyclicity (no path from target back to source exists after adding the proposed
edge), branch-node arity (a branch node's condition-arm handle may only have one outgoing
connection), valid handle pairs (a node's output handle may not connect to its own input
handle). Violations SHALL be silently rejected (the edge is not added) and SHALL produce
a user-visible inline message in the Problems panel.

#### Scenario: Connecting a node to itself is rejected
- **WHEN** a user attempts to drag an edge from a node's output handle back to the same node's input handle
- **THEN** the system SHALL discard the connection attempt
- **THEN** no self-loop edge SHALL appear in the graph

#### Scenario: Creating a cycle is rejected
- **WHEN** a user attempts to add edge B→A when path A→B already exists in the canvas graph
- **THEN** the system SHALL detect the cycle and discard the edge
- **THEN** the Problems panel SHALL display a message referencing the acyclicity rule (FLW-E002)

#### Scenario: Overfilling a branch arm handle is rejected
- **WHEN** a user attempts to connect a second outgoing edge to a branch node's single condition-arm handle
- **THEN** the system SHALL reject the connection
- **THEN** the existing connection on that handle SHALL remain unchanged

---

### Requirement: Property panels generate forms from task input JSON Schemas

The system SHALL render a per-node property panel when a node is selected on the canvas.
For `task` nodes, the panel SHALL generate form fields dynamically from the
`inputSchema` of the matching `TaskTypeDescriptor` returned by the task-type catalog.
The panel SHALL include: a retry-policy sub-form (fields: `maxAttempts` integer,
`backoffCoefficient` decimal, `initialInterval` ISO 8601 duration string), and expression
fields for string-typed inputs (rendered with syntax validation using the expression
syntax rule `FLW-E005`). All panel inputs SHALL be controlled React components whose
changes are immediately reflected in the in-memory DSL model.

#### Scenario: Selecting a task node opens its property panel
- **WHEN** a user clicks a `task` node on the canvas
- **THEN** the property panel SHALL appear and display form fields derived from the task type's `inputSchema`
- **THEN** changes to panel fields SHALL update the in-memory DSL model without requiring an explicit save

#### Scenario: Retry policy editor validates maxAttempts
- **WHEN** the user enters a non-integer value in the `maxAttempts` field of the retry-policy editor
- **THEN** the field SHALL display an inline validation error
- **THEN** the invalid value SHALL NOT be written to the DSL model

#### Scenario: Expression field rejects syntactically invalid expressions
- **WHEN** the user types an expression string that violates the expression engine syntax (FLW-E005)
- **THEN** the field SHALL display an inline syntax error
- **THEN** the error SHALL also appear in the Problems panel with code FLW-E005 and the node ID

---

### Requirement: Client-side semantic validation runs on every graph change

The system SHALL run the semantic validation rules `FLW-E001`…`FLW-E009` (as defined in
the `add-flows-dsl-schema` spec) against the in-memory DSL model after every structural
graph change (node add/remove, edge add/remove, property edit). Validation results SHALL
be node-scoped: each `ValidationError` SHALL carry a `nodeId`, `code`, and `message`.
The system SHALL distribute errors to the corresponding node components (via
`data.validationErrors`) so they render badge overlays, and SHALL aggregate all errors in
a Problems panel visible below or alongside the canvas.

#### Scenario: Duplicate node IDs produce FLW-E001 badge on affected nodes
- **WHEN** the in-memory DSL model contains two nodes with the same `id`
- **THEN** both affected node components SHALL render an error badge
- **THEN** the Problems panel SHALL list an entry with code `FLW-E001`

#### Scenario: Dangling edge reference produces FLW-E003 in Problems panel
- **WHEN** a node's `next` field references an ID that does not exist in the nodes array
- **THEN** the Problems panel SHALL display an entry with code `FLW-E003` and the originating node ID

#### Scenario: Clean graph shows no error badges and empty Problems panel
- **WHEN** the in-memory DSL model passes all semantic rules
- **THEN** no node SHALL render an error badge
- **THEN** the Problems panel SHALL be empty or hidden

---

### Requirement: Server 422 errors are mapped onto canvas nodes

The system SHALL intercept 422 responses from `validateFlow` and `publishFlow` API
calls. When the response body contains an `errors` array where entries carry a `nodeId`
field, the system SHALL map each error onto the corresponding canvas node by merging the
server error into that node's `data.validationErrors` array. Errors without a `nodeId`
SHALL be displayed in the Problems panel as flow-level errors.

#### Scenario: 422 response with nodeId errors decorates the correct nodes
- **WHEN** `publishFlow` returns a 422 with `errors: [{"nodeId": "step-1", "code": "FLW-E006", "message": "Unknown task type"}]`
- **THEN** the canvas node whose `id` is `"step-1"` SHALL render an error badge
- **THEN** the Problems panel SHALL display the error with code `FLW-E006`

#### Scenario: 422 response without nodeId shows as flow-level error
- **WHEN** `publishFlow` returns a 422 with `errors: [{"code": "FLW-E099", "message": "Flow name already exists"}]`
- **THEN** no individual node badge SHALL be added
- **THEN** the Problems panel SHALL display the error as a flow-level item

---

### Requirement: Canvas layout is persisted in the DSL canvasMetadata section

The system SHALL write each node's `{x, y}` position from the `@xyflow/react` layout
into the DSL `canvasMetadata.nodes` map (keyed by node ID) on every draft save, and
SHALL read initial positions from `canvasMetadata.nodes` when loading an existing flow
definition. Positions SHALL be floats in logical canvas pixels. The `canvasMetadata`
section SHALL NOT affect server-side execution semantics (consistent with the
`add-flows-dsl-schema` requirement for that section).

#### Scenario: Draft save writes node positions to canvasMetadata
- **WHEN** the user repositions a node to coordinates (320, 140) and saves the draft
- **THEN** the persisted flow definition SHALL contain `canvasMetadata.nodes["<nodeId>"] = {"x": 320, "y": 140}`

#### Scenario: Loading a flow restores node positions from canvasMetadata
- **WHEN** a flow definition is loaded that contains `canvasMetadata.nodes` entries
- **THEN** each canvas node SHALL be initialised at the position recorded in `canvasMetadata.nodes`

#### Scenario: Flow without canvasMetadata renders with auto-layout
- **WHEN** a flow definition is loaded that contains no `canvasMetadata` section
- **THEN** the designer SHALL apply a default auto-layout algorithm to position nodes
- **THEN** no error or warning SHALL be shown to the user

---

### Requirement: Draft save, load, and publish lifecycle is fully supported from the canvas

The system SHALL provide toolbar controls in `ConsoleFlowDesignerPage` for:
save-as-draft (calling `updateFlowDraft`), revert-to-saved (reloading the last persisted
draft), and publish (calling `publishFlow`). The publish action SHALL be disabled while
any `ValidationError` with a blocking severity is present in the client-side validation
result. After a successful publish the UI SHALL display a confirmation and reflect the
new published version.

#### Scenario: Save draft persists the current canvas state
- **WHEN** the user clicks "Save draft"
- **THEN** the system SHALL call `updateFlowDraft` with the current DSL model including `canvasMetadata`
- **THEN** the toolbar SHALL display a "Saved" confirmation and the unsaved-changes indicator SHALL clear

#### Scenario: Publish is blocked when blocking validation errors exist
- **WHEN** the Problems panel contains at least one error with blocking severity
- **THEN** the "Publish" button SHALL be disabled
- **THEN** a tooltip or inline message SHALL indicate that errors must be resolved first

#### Scenario: Successful publish updates the displayed version
- **WHEN** `publishFlow` returns a success response with a version number
- **THEN** the designer header SHALL display the new published version identifier
- **THEN** the "Publish" button SHALL return to enabled state (for future edits)

---

### Requirement: Component tests cover graph-to-DSL-model mapping and connection rules

The system SHALL include Vitest component tests under
`apps/web-console/src/__tests__/` that cover: serialising a multi-node canvas graph to
the DSL `nodes` array (including `canvasMetadata` positions), deserialising a DSL
definition back to `@xyflow/react` node and edge arrays, and rejecting illegal connections
(self-loop, cycle, overfull branch handle). Tests SHALL use `@testing-library/react`
(already in `apps/web-console/package.json` devDependencies). All new tests SHALL pass;
the pre-existing failing test set SHALL remain unchanged (the web-console vitest baseline
is broken on main — verification is new-tests-pass + unchanged failing set).

#### Scenario: Graph serialisation round-trip preserves node count and types
- **WHEN** a three-node canvas graph (task → branch → task) is serialised to DSL and deserialised back
- **THEN** the resulting `@xyflow/react` nodes array SHALL contain exactly three entries
- **THEN** each entry's `type` SHALL match the original DSL node type

#### Scenario: Self-loop connection rule test rejects invalid edge
- **WHEN** the connection-validation function is called with `source === target`
- **THEN** the function SHALL return `false`

#### Scenario: New tests pass without changing the pre-existing failing set
- **WHEN** `vitest run` is executed after adding the new test files
- **THEN** all new test files SHALL report 0 failures
- **THEN** the set of pre-existing failing tests SHALL be identical to the baseline recorded before this change
