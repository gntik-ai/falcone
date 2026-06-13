## ADDED Requirements

### Requirement: Falcone ships a first-party, read-first MCP server
The system SHALL provide a first-party MCP server that exposes a curated catalog of Falcone management tools, where read (non-mutating) tools are callable with the base MCP scope and every mutating tool requires an explicit, named per-tool scope.

#### Scenario: Read tool callable by default
- **WHEN** a client lists tools and calls a read (non-mutating) tool with the base MCP scope
- **THEN** the server returns the result without requiring an additional scope

#### Scenario: Mutating tool refused without its scope
- **WHEN** a client calls a mutating tool whose explicit scope is not in the caller's granted scopes
- **THEN** the server refuses the call

#### Scenario: Mutating tool allowed with its scope
- **WHEN** a client calls a mutating tool and the caller holds that tool's explicit scope
- **THEN** the server performs the operation against the control-plane on behalf of the credential-derived tenant

### Requirement: First-party tools are curated and LLM-optimized
Every tool in the first-party catalog SHALL carry a non-trivial, LLM-optimized description and an input schema, and mutating tools SHALL be clearly identifiable as such; the catalog SHALL be a curated subset of the management surface, not a 1:1 export of every route.

#### Scenario: Every tool is described and classified
- **WHEN** the catalog is inspected
- **THEN** every tool has a description and an input schema, and each tool is marked as read or mutating with mutating tools carrying a scope
