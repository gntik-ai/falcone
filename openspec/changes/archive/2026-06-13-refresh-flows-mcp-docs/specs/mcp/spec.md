## ADDED Requirements

### Requirement: MCP documentation reflects the live management API
The system SHALL document that the control-plane runtime serves the MCP management API under `/v1/mcp`, with concrete examples that match the real endpoint shapes and the runtime engine, including an end-to-end create → curate → publish → call → observe walkthrough and an example tool definition.

#### Scenario: MCP docs show the live API with a working example
- **WHEN** a reader views the MCP guide
- **THEN** the real `/v1/mcp/workspaces/{workspaceId}/servers` route table and an end-to-end example are shown, matching the implemented runtime

### Requirement: MCP documentation states accurate per-layer status
The system SHALL label each MCP layer with its real status — Instant MCP and the official server as Preview (live), and custom (bring-your-own-image) hosting and workflows-as-MCP-tools as Experimental (built but not on the live create path) — and SHALL note that server state is in-memory.

#### Scenario: Each layer carries an accurate status label
- **WHEN** a reader views the MCP guide or architecture page
- **THEN** instant/official are labelled Preview and custom-hosting/workflows-as-tools are labelled Experimental, with the in-memory state noted

### Requirement: The roadmap distinguishes shipped from planned
The system SHALL present shipped capabilities (Flows, MCP) as Preview and SHALL keep genuinely-future items as planned, including object-storage / document-DB alternatives that are not yet implemented in the repository.

#### Scenario: The roadmap reflects the real state
- **WHEN** a reader views the roadmap
- **THEN** Flows and MCP are shown as shipped Preview, and unimplemented items (including the SeaweedFS / FerretDB+DocumentDB alternatives) are clearly marked planned and under evaluation
