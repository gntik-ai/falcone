## ADDED Requirements

### Requirement: Mongo collection delete events MUST be delivered to the owning tenant

The system SHALL deliver collection `delete` events to the owning tenant's subscribers, keyed off the change pre-image so the event can be tenant-scoped. On the live realtime path — Postgres logical replication over the DocumentDB engine (add-ferretdb-realtime-cdc-remediation, #460), which replaced the MongoDB change-stream engine — `REPLICA IDENTITY FULL` makes the delete pre-image (`fullDocumentBeforeChange`) available and the executor filters on its `tenantId` consumer-side, so deletes are delivered and never cross tenants.

#### Scenario: Owning tenant's subscriber receives a delete frame

- **WHEN** a tenant subscribes to a collection and a document in that collection is deleted via the driver
- **THEN** the owning tenant's subscriber receives a `delete` frame for that document

#### Scenario: Cross-tenant deletes are not delivered

- **WHEN** a document belonging to Tenant A is deleted
- **THEN** Tenant B's subscriber receives no `delete` frame for that document
