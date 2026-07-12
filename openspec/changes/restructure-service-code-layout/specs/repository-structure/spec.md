# repository-structure

## ADDED Requirements

### Requirement: Release-deployed services live under apps with co-located release Dockerfiles
Every release-deployed product service SHALL live under `apps/<service>` and SHALL co-locate its
release Dockerfile with its source. The release restructure SHALL preserve the existing published
image names and chart alias/value keys.

#### Scenario: Service discovery by release matrix
- **WHEN** the release image matrix is reconciled with the repository layout
- **THEN** the six release services are found under `apps/control-plane`,
  `apps/control-plane-executor`, `apps/web-console`, `apps/fn-runtime`,
  `apps/workflow-worker`, and `apps/mcp-runtime`
- **AND** each release Dockerfile is co-located below that service root
- **AND** the image identities `in-falcone-control-plane`,
  `in-falcone-control-plane-executor`, `in-falcone-web-console`,
  `in-falcone-fn-runtime`, `in-falcone-workflow-worker`, and
  `in-falcone-mcp-runtime` remain unchanged
- **AND** the chart aliases/value keys remain unchanged

### Requirement: Shared code is separated from services
Code shared across services or consumed as product actions/libraries SHALL live in a dedicated
shared area distinct from release service directories.

#### Scenario: Shared modules are not nested inside a service
- **WHEN** the layout is inspected
- **THEN** shared modules live under `packages/<name>` and are consumed by services via the
  workspace, not copied into each service
- **AND** deploy configuration roots such as gateway and Keycloak config live under `deploy/`
- **AND** developer tools such as the Falcone CLI live under `tools/`

### Requirement: A service catalog documents release and non-release entries
The repository SHALL provide a top-level structured service catalog that lists every
release-deployed service with its language, image identity, chart alias/value key, source,
Dockerfile, direct dependencies and inter-service calls.

#### Scenario: Catalog completeness
- **WHEN** the service catalog is read
- **THEN** every release-deployed service appears with its language, image identity, chart
  alias/value key, source, Dockerfile, direct dependencies and inter-service calls
- **AND** the catalog reconciles exactly to the release-image matrix

### Requirement: Non-release candidates are explicit evidence only
Incomplete or non-release candidate roots SHALL be represented without claiming they are published
release services.

#### Scenario: Non-release candidates are not overclaimed
- **WHEN** `mongo-cdc-bridge`, `pg-cdc-bridge`, `realtime-gateway`, and
  `workspace-docs-service` are inspected
- **THEN** each is cataloged with `release: false` evidence metadata
- **AND** none appears in the release image matrix as a published service

### Requirement: The restructure is behavior-preserving
The restructure SHALL NOT change runtime behavior; local validators and focused tests SHALL use the
new paths and guard against the old source roots reappearing.

#### Scenario: Validators and tests use the new layout
- **WHEN** repository validators, service-catalog tests, package generation/validation, console
  build/test, Dockerfile path checks and focused unit/contract tests are run after the restructure
- **THEN** they resolve the new `apps/`, `packages/`, `deploy/` and `tools/` paths
- **AND** they reject the old release source roots for moved services
