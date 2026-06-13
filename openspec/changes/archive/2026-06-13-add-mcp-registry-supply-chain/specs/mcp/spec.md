## ADDED Requirements

### Requirement: Per-tenant MCP server registry with digest-pinned versions
The system SHALL maintain a per-tenant registry of MCP servers in which every server version is pinned by an immutable image digest and carries its manifest and source, and registry entries SHALL be tenant-scoped so that a read with a different tenant identity does not return another tenant's entry.

#### Scenario: A version is registered pinned by digest
- **WHEN** a server version is registered with an image referenced only by a mutable tag (no digest)
- **THEN** the registration is rejected and no version is recorded

#### Scenario: Registry entries are tenant-scoped
- **WHEN** a registry entry is read with a tenant identity other than the one that owns it
- **THEN** the lookup returns nothing and never another tenant's entry

### Requirement: Image signature and supply-chain verification at deploy
The system SHALL reject deploying an MCP server image that is unpinned, from a registry not on the allow-list, or whose signature has not been verified, applying the same image supply-chain rules as the platform's deployable images.

#### Scenario: Unsigned image is rejected
- **WHEN** a deploy is attempted for an image whose signature did not verify
- **THEN** the deploy is rejected with a signature-verification violation

#### Scenario: Unpinned image is rejected
- **WHEN** a deploy is attempted for an image pinned only to the mutable `latest` tag
- **THEN** the deploy is rejected with an image-not-pinned violation

### Requirement: A version bump that changes tool descriptions or scopes requires review before serving
The system SHALL compute the difference in tools, descriptions, and scopes between a server's active version and a new version, and WHEN any tool-facing change is present the new version SHALL be marked as requiring review and SHALL NOT serve traffic until a tenant explicitly approves it.

#### Scenario: Changed tool description is held for review
- **WHEN** a new server version changes a tool's description or scope relative to the active version
- **THEN** the new version is marked as requiring review and cannot be activated until approved

#### Scenario: Approved version serves traffic
- **WHEN** a tenant approves a review-required version
- **THEN** the version can be activated and serves traffic

### Requirement: Rollback to a previously pinned version
The system SHALL allow rolling back to a previously approved, digest-pinned version of a server, re-activating it without requiring a new review.

#### Scenario: Rollback re-activates a prior pinned version
- **WHEN** a tenant rolls back a server to an earlier approved version
- **THEN** that version becomes active by its retained digest without a new review
