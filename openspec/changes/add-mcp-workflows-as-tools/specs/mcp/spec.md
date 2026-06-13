## ADDED Requirements

### Requirement: A published flow is exposed as a long-running MCP tool
The system SHALL expose a tenant's published flow as an MCP tool whose input schema is the flow's input contract and which is marked as long-running (executed via the Tasks extension), and invoking the tool SHALL start a flow execution and return a Task handle keyed by the execution id without holding a synchronous connection.

#### Scenario: Invoking a flow tool starts a Task
- **WHEN** a client calls the MCP tool for a published flow
- **THEN** a flow execution is started and the call returns a Task handle identifying that execution

#### Scenario: Flow input schema is the tool input schema
- **WHEN** the tool for a published flow is listed
- **THEN** its input schema matches the flow's declared input contract and it is marked long-running

### Requirement: Flow execution status maps to MCP Task status
The system SHALL map a flow execution's status to an MCP Task status — running to working, completed to completed (with the result), failed to failed (with the error), cancelled to cancelled — readable by polling the execution and observable via the existing events stream.

#### Scenario: Running execution reports working
- **WHEN** the Task for a still-running flow execution is polled
- **THEN** it reports a working status

#### Scenario: Completed execution returns the result
- **WHEN** the flow execution completes and the Task is polled
- **THEN** it reports completed and returns the structured result

### Requirement: Flow tools are tenant-scoped
The system SHALL derive the tenant/workspace for a flow tool from the verified credential, never from tool arguments, and apply the tenant's flow quotas.

#### Scenario: Tenant is credential-derived
- **WHEN** a flow tool is invoked
- **THEN** the execution is scoped to the credential-derived tenant/workspace, regardless of any tenant value in the arguments
