## ADDED Requirements

### Requirement: Document by-id operations MUST match the stored ObjectId

The system SHALL coerce a by-id document key to a BSON `ObjectId` (falling back to a string match for ids that are not valid ObjectIds) before querying, so that get/update/replace/delete by id operate on the stored document rather than silently no-op'ing.

#### Scenario: By-id get returns the stored document

- **WHEN** a client inserts a document and then issues `GET …/documents/{insertedId}` using the returned id
- **THEN** the system returns the stored document (`found:true`)

#### Scenario: By-id delete removes the stored document

- **WHEN** a client issues a DELETE for a real document id
- **THEN** the system removes the document and reports `deleted:1`
