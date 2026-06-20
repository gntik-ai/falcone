## MODIFIED Requirements

### Requirement: Falcone ships a first-party, read-first MCP server

The system SHALL provide a first-party MCP server that exposes a curated catalog of Falcone management tools, where read (non-mutating) tools are callable with the base MCP scope and every mutating tool requires an explicit, named per-tool scope. When the first-party server is enabled, the base MCP scope (`mcp:invoke`) SHALL be granted to an authenticated tenant principal so that a read tool is callable end-to-end on every deployment profile without a separately-provisioned scope; mutating tools still require their explicit named per-tool scope (`mcp:falcone:*`). Tool request paths SHALL be resolved against the credential-derived tenant — the tenant SHALL NEVER be taken from tool arguments; other path parameters (workspace and resource identifiers) come from tool arguments.

#### Scenario: Read tool callable by an authenticated principal with base scope auto-granted

- **WHEN** an authenticated tenant principal calls a read tool (e.g. `list_workspaces`) via `POST /v1/mcp/rpc` with the first-party server enabled
- **THEN** the server grants the base `mcp:invoke` scope to the authenticated principal and returns the tool result without requiring the caller to hold a pre-provisioned `mcp:invoke` scope

#### Scenario: Mutating tool still refused without its explicit scope

- **WHEN** an authenticated principal calls a mutating tool (e.g. `create_workspace`) without the tool's declared per-tool scope in the verified token
- **THEN** the server refuses the call with a JSON-RPC error and no control-plane call is made

#### Scenario: Mutating tool allowed with its scope

- **WHEN** an authenticated principal holds both `mcp:invoke` and a mutating tool's declared scope (e.g. `mcp:falcone:workspaces:write`)
- **THEN** the server executes the tool against the control-plane on the caller's behalf and returns the result

#### Scenario: Tenant is credential-derived even if a tool argument tries to supply one

- **WHEN** a tool call includes a `tenantId` field in the tool arguments
- **THEN** the request is dispatched using the tenant derived from the verified credential, not the value from the argument

## ADDED Requirements

### Requirement: Control-MCP tools target routes the runtime actually serves

The system SHALL map every first-party control-MCP tool to a management route the platform runtime actually serves, so an authorized tool call reaches a real handler rather than a 404. The credential-derived tenant SHALL be substituted into tenant-scoped path segments (e.g. `{tenantId}`) automatically from the verified identity; tool arguments SHALL only supply non-tenant path parameters and request bodies.

#### Scenario: A read tool call resolves to a served route and returns data (not 404)

- **WHEN** an authorized principal calls a read tool whose path requires a tenant segment
- **THEN** the dispatcher substitutes the credential-derived tenant into the path and the request reaches a real runtime handler, returning a successful response rather than a 404

#### Scenario: A tool whose path needs the tenant has it injected from the credential

- **WHEN** a tool is defined with a `{tenantId}` segment in its path
- **THEN** the dispatcher resolves that segment from the verified credential identity and not from any tool argument

#### Scenario: An argument-supplied tenant value is ignored

- **WHEN** a tool call passes a `tenantId` value in its arguments
- **THEN** the dispatcher does not use that value for path construction; the credential-derived tenant is used instead

### Requirement: The first-party control MCP covers the tenant management surface

The first-party catalog SHALL expose a curated-but-comprehensive set of tools across the tenant management families it serves (workspaces lifecycle, service accounts and credentials, databases, function registry, tenant users and auth config, quotas and entitlements, observability and metrics, storage, events, webhooks, API keys, embedding configuration), remaining a curated subset (not a 1:1 export of every route) with each tool carrying a description, an input schema, and a read/mutating classification.

#### Scenario: The catalog exposes materially more tools than the original nine and spans multiple families

- **WHEN** a client calls `tools/list` on the first-party server after this change
- **THEN** the catalog contains tools from at least five distinct management families and the total count is materially greater than nine

#### Scenario: Every tool carries a description, input schema, and read/mutating classification

- **WHEN** the catalog is inspected
- **THEN** every tool has a non-empty description, an input schema object, and is classified as either read-only or mutating with mutating tools carrying an explicit per-tool scope

### Requirement: The first-party MCP provides a deterministic authoring planner

The system SHALL provide a first-party authoring tool (`plan_project`) that accepts a declarative desired-state project specification and returns an ordered, validated plan of catalog tool calls (a reason-then-define-then-deploy scaffold), without invoking any external LLM in the control plane; the reasoning is performed by the MCP client and the server provides the deterministic define-and-deploy plan.

#### Scenario: A valid desired-state spec yields an ordered plan with dependencies respected

- **WHEN** a caller invokes the `plan_project` authoring tool with a valid desired-state project spec (e.g. workspace name plus a database and a function)
- **THEN** the server returns an ordered list of catalog tool calls whose dependencies are respected (e.g. workspace creation appears before provisioning its database) and every step references a real catalog tool name

#### Scenario: An invalid or under-specified spec is rejected with a validation error and no plan

- **WHEN** a caller invokes `plan_project` with a spec that is missing required fields or is structurally invalid
- **THEN** the server returns a JSON-RPC error or an `isError: true` tool result with a validation message and no plan steps are returned

### Requirement: First-party MCP configuration is superadmin-only and RBAC-gated

The set of enabled first-party MCP tools and whether the server is enabled SHALL be configurable at runtime through superadmin-only, RBAC-gated tools rather than only a deploy-time constant. Reading the configuration SHALL be available to any authenticated principal. Changing the configuration SHALL require the caller to hold the `superadmin` or `platform_admin` role (per the `KEY_MGMT_ADMIN_ROLES` convention). A disabled tool SHALL NOT appear in `tools/list` nor be callable.

#### Scenario: A non-superadmin attempt to change the config is refused

- **WHEN** an authenticated principal without a superadmin or platform_admin role calls the `set_mcp_config` tool
- **THEN** the call is refused with a JSON-RPC error and the configuration is unchanged

#### Scenario: A superadmin disables a tool and it disappears from tools/list and becomes uncallable

- **WHEN** a principal holding the `superadmin` role calls `set_mcp_config` to disable a specific tool and then calls `tools/list`
- **THEN** the disabled tool is absent from the tool list and a subsequent `tools/call` for that tool returns an unknown-tool error

#### Scenario: Reading the config is allowed for an authenticated principal

- **WHEN** any authenticated principal calls `get_mcp_config`
- **THEN** the server returns the current enabled/disabled tool configuration without requiring a superadmin role

### Requirement: Authorized control-MCP tool calls succeed end-to-end

With the first-party server enabled, an authenticated tenant principal calling a permitted tool SHALL receive the tool's result (the same effect as the equivalent REST call) rather than a `-32001 missing required scope` error or a 404 from a mismatched route.

#### Scenario: An authenticated principal calls a read tool and gets data, not -32001

- **WHEN** an authenticated tenant principal calls a read tool (e.g. `list_workspaces`) via `POST /v1/mcp/rpc`
- **THEN** the response is a JSON-RPC success with tool content and the `content[0].text` contains the workspace list, not a `-32001` error

#### Scenario: An authenticated principal calls a mutating tool it holds the scope for and the control-plane performs the effect

- **WHEN** an authenticated principal holding a mutating tool's scope calls that tool via `POST /v1/mcp/rpc`
- **THEN** the response is a JSON-RPC success and the effect (e.g. workspace created) is observable via the equivalent REST endpoint
