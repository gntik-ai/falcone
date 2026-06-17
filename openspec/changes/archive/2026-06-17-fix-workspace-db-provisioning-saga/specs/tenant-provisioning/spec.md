## ADDED Requirements

### Requirement: Workspace creation MUST provision a real backing database

The system SHALL, when a workspace is created, complete the provisioning saga that creates the backing `wsdb_*` Postgres database, and SHALL NOT leave a `workspace_databases` registry row without a corresponding physical database.

#### Scenario: A new workspace gets a real database

- **WHEN** a client calls `POST /v1/workspaces` and the provisioning saga completes
- **THEN** the backing `wsdb_*` Postgres database exists and the data API connects to it

#### Scenario: No orphaned registry rows

- **WHEN** a workspace's provisioning saga fails to create the physical database
- **THEN** the system does not report the workspace as ready with an orphaned registry row
