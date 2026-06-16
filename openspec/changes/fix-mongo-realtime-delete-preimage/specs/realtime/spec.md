## ADDED Requirements

### Requirement: Mongo collection delete events MUST be delivered to the owning tenant

The system SHALL deliver Mongo change-stream `delete` events to the owning tenant's subscribers by keying the event off the change-stream `documentKey` and stored `tenantId` (or a pre-image lookup), instead of relying on `fullDocumentBeforeChange` which may be unpopulated.

#### Scenario: Owning tenant's subscriber receives a delete frame

- **WHEN** a tenant subscribes to a collection and a document in that collection is deleted via the driver
- **THEN** the owning tenant's subscriber receives a `delete` frame for that document

#### Scenario: Cross-tenant deletes are not delivered

- **WHEN** a document belonging to Tenant A is deleted
- **THEN** Tenant B's subscriber receives no `delete` frame for that document
