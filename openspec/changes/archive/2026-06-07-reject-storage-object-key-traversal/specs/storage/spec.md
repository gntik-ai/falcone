## ADDED Requirements

### Requirement: Object key validation rejects path traversal sequences

The system SHALL reject any object key that contains a `..` path segment (a segment equal to `..` when split on `/`), a backslash character (`\`), or a control character in the range 0x00–0x1F or 0x7F. The system SHALL throw `INVALID_OBJECT_KEY` for such keys before any storage operation is performed. Rejection MUST occur in `assertObjectKey` so that all storage operations (create, read, update, delete, presigned URL, list) benefit uniformly.

#### Scenario: Key containing a dot-dot segment is rejected

- **WHEN** a caller submits an object key containing a `..` segment (e.g., `uploads/../../tenants/tenant-b/workspaces/ws-b/secret`)
- **THEN** the system returns HTTP 400 with error code `INVALID_OBJECT_KEY`
- **AND** no storage read or write is attempted

#### Scenario: Key containing a backslash is rejected

- **WHEN** a caller submits an object key containing a backslash character (e.g., `uploads\file.txt`)
- **THEN** the system returns HTTP 400 with error code `INVALID_OBJECT_KEY`

#### Scenario: Key containing a control character is rejected

- **WHEN** a caller submits an object key containing a character in the range 0x00–0x1F or 0x7F (e.g., a NUL byte or DEL character embedded in the key)
- **THEN** the system returns HTTP 400 with error code `INVALID_OBJECT_KEY`

#### Scenario: Legitimate forward-slash-delimited key is accepted

- **WHEN** a caller submits a valid object key using only forward slashes as directory separators (e.g., `uploads/2026/report.pdf`)
- **THEN** the system proceeds with the storage operation normally and does not return `INVALID_OBJECT_KEY`

### Requirement: Workspace-prefix containment is re-asserted after key concatenation

The system SHALL, after computing the canonical object path by concatenating the workspace object prefix with the normalized object key, normalize the resulting path and assert that it begins with the workspace object prefix. If the normalized canonical path does not begin with the workspace object prefix, the system SHALL throw `INVALID_OBJECT_KEY` and abort the operation without performing any storage read or write.

#### Scenario: Traversal key that bypasses syntactic validation is caught at containment check

- **WHEN** an object key passes syntactic validation but the computed `canonicalObjectPath` does not begin with the workspace `objectPrefix` after path normalization
- **THEN** the system throws `INVALID_OBJECT_KEY` before any storage operation
- **AND** no cross-tenant or cross-workspace path is accessed

#### Scenario: Valid key remains within workspace prefix after concatenation

- **WHEN** a caller submits a valid object key and the computed `canonicalObjectPath` begins with the workspace `objectPrefix` after normalization
- **THEN** the storage operation proceeds normally

### Requirement: Object key validation is applied uniformly to all storage operations

The system SHALL apply `assertObjectKey` validation, including the traversal rejection rules, before every storage operation that accepts an `objectKey` parameter, including object create, read, update, delete, presigned URL generation, and list operations. No storage operation MUST bypass the validator.

#### Scenario: Traversal key rejected on presigned URL generation

- **WHEN** a caller requests a presigned URL with an object key containing a `..` segment
- **THEN** the system returns HTTP 400 with error code `INVALID_OBJECT_KEY`
- **AND** no presigned URL is generated

#### Scenario: Traversal key rejected on object delete

- **WHEN** a caller requests deletion of an object with a key containing a `..` segment
- **THEN** the system returns HTTP 400 with error code `INVALID_OBJECT_KEY`
- **AND** no deletion is performed
