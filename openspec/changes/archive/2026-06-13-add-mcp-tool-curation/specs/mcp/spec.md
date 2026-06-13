## ADDED Requirements

### Requirement: A draft tool set is curated before it can be served
The system SHALL let a tenant curate a draft tool set — enable or disable individual tools, override their descriptions, and assign per-tool scopes — producing a curated tool set distinct from the draft.

#### Scenario: Disabled tools are excluded
- **WHEN** a curator disables a tool and applies the curation
- **THEN** the curated tool set does not contain that tool

#### Scenario: Description and scope edits are applied
- **WHEN** a curator overrides a tool's description and assigns it a scope
- **THEN** the curated tool carries the new description and scope

### Requirement: Only a published curated tool set is connectable
The system SHALL treat a tool set as connectable only after it has been published, and publishing SHALL be refused unless every enabled mutating tool has an assigned scope and at least one tool is enabled. A draft or un-published curated set MUST NOT be connectable.

#### Scenario: Draft is not connectable
- **WHEN** a tool set is still a draft (not published)
- **THEN** it is not connectable

#### Scenario: Publish refused when an enabled mutating tool lacks a scope
- **WHEN** a curated set contains an enabled mutating tool with no assigned scope and publish is attempted
- **THEN** publishing is refused with a violation and the set remains non-connectable

#### Scenario: Published set is connectable
- **WHEN** a curated set with all enabled mutating tools scoped (and at least one tool enabled) is published
- **THEN** it becomes connectable and serves exactly the curated tools
