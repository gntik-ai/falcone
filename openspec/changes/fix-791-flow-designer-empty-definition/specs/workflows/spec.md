# workflows - spec delta for fix-791-flow-designer-empty-definition

## MODIFIED Requirements

### Requirement: Canvas layout is persisted in the DSL canvasMetadata section

The system SHALL write each node's `{x, y}` position from the `@xyflow/react` layout into the DSL
`canvasMetadata.nodes` map (keyed by node ID) on every draft save, and SHALL read initial positions
from `canvasMetadata.nodes` when loading an existing flow definition. Positions SHALL be floats in
logical canvas pixels. The `canvasMetadata` section SHALL NOT affect server-side execution
semantics.

The system SHALL treat a flow definition with missing or absent `nodes` as an empty node list when
projecting it onto the console flow-designer canvas. `definitionToNodes`, `definitionToEdges`, and
`autoLayout` SHALL behave as though the node list were `[]` for projection and layout purposes, so a
freshly-created flow whose API record has `definition: {}` opens as an empty canvas without a load
error, error banner, or crash. This projection tolerance does not make an empty draft publishable:
validate/publish and the workflow worker continue to enforce the full DSL schema and executable
node-graph requirements.

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

#### Scenario: Fresh empty draft renders an empty canvas

- **WHEN** the designer loads a flow API record whose `definition` is `{}` or otherwise has no
  `nodes` field
- **THEN** `definitionToNodes`, `definitionToEdges`, and `autoLayout` SHALL treat the node list as
  `[]`, returning empty canvas nodes/edges/layout maps without throwing
- **THEN** the designer SHALL render an empty canvas and SHALL NOT show a load-error banner or crash
