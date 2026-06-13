## ADDED Requirements

### Requirement: Instant MCP generates a draft tool manifest from tenant resources
The system SHALL generate MCP tools from a tenant's existing resources — database schema, functions, storage and events — via an extensible set of per-resource generators, producing a draft manifest in which each tool has a name, an LLM-oriented description, an input schema, a mutation flag, a suggested scope, and a reference to its source resource.

#### Scenario: Schema produces query tools
- **WHEN** Instant MCP generation runs over a database schema with tables
- **THEN** the draft manifest contains a read query tool per table whose input schema is derived from the table's columns

#### Scenario: Functions, storage and events produce tools
- **WHEN** generation runs over the tenant's functions, storage buckets and event topics
- **THEN** the draft manifest contains corresponding action, object and publish/subscribe tools

### Requirement: Generated tools are never published without curation
The Instant MCP generator SHALL only ever produce a draft manifest marked as requiring curation, and SHALL NOT produce a published/connectable tool set; publishing happens only after curation.

#### Scenario: Output is a draft requiring curation
- **WHEN** the generator runs
- **THEN** the resulting manifest is marked as a draft that requires curation, and no tool is connectable until it is curated and published

### Requirement: Generated data tools map to tenant-scoped, RLS-bound operations
Generated tools that read or write tenant data SHALL map to the platform's tenant-scoped, RLS-bound data operations, so that executing a generated tool cannot return or modify another tenant's data.

#### Scenario: Generated query tool is tenant-scoped
- **WHEN** a generated query tool maps to a database table operation
- **THEN** it targets the platform's RLS-bound data path so the operation is constrained to the calling tenant
