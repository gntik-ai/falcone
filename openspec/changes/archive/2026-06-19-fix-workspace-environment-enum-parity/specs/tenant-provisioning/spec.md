# tenant-provisioning — spec delta for fix-workspace-environment-enum-parity

## ADDED Requirements

### Requirement: OpenAPI WorkspaceEnvironment enum stays in parity with the implemented catalog

The system SHALL publish a `WorkspaceEnvironment` enum in its OpenAPI contract that contains every
value present in the runtime `ENVIRONMENT_CATALOG`
(`deploy/kind/control-plane/b-handlers.mjs`), so that clients generated from the spec accept all
environment values the server accepts, including `preview`.

#### Scenario: preview value accepted by spec and runtime alike

- **WHEN** a caller creates or queries a workspace with `environment: "preview"`
- **THEN** the OpenAPI `WorkspaceEnvironment` enum lists `"preview"` as a valid member, and the
  runtime handler accepts the value without returning a 400 INVALID_ENVIRONMENT error
