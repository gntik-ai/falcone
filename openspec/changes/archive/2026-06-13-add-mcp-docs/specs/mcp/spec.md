## ADDED Requirements

### Requirement: MCP has a tenant guide in the docs-site
The system SHALL publish a tenant guide for MCP server hosting covering the server sources (Instant, custom, official), mandatory curation, connecting clients with working snippets, the CLI, and the Server SDK.

#### Scenario: The guide covers sources, connection, and the SDK
- **WHEN** a tenant reads the MCP guide
- **THEN** it explains Instant MCP / custom hosting / the official server, how to connect Cursor / Claude Code / claude.ai / VS Code, and how to write a tool with the Server SDK

### Requirement: MCP has internal architecture and runbook docs linked in the nav
The system SHALL publish an internal architecture document and an operational runbook for MCP, linked in the docs-site navigation and cross-linked to the MCP ADR.

#### Scenario: Architecture and runbook are published and linked
- **WHEN** the docs-site is built and navigated
- **THEN** the MCP architecture doc and runbook are present in the sidebar and cross-link to ADR-12

#### Scenario: The docs-site build is green with no dead links
- **WHEN** the docs-site is built
- **THEN** the build succeeds and reports no dead links
