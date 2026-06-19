# storage — spec delta for fix-storage-object-key-validation

## ADDED Requirements

### Requirement: Object keys are validated and traversal attempts return 4xx

The system SHALL validate every object key received by the storage object handlers
(`storageGetObject`, `storagePutObject`, `storageDeleteObject`,
`storageObjectMetadata` in `deploy/kind/control-plane/storage-handlers.mjs`) BEFORE
any backend or database call, rejecting keys that contain `..` path segments, a
leading `/`, backslash characters, ASCII control characters, an empty value, a value
exceeding 1024 characters, or malformed percent-encoding — returning HTTP 400 with
error code `INVALID_OBJECT_KEY` — so that path-traversal and malformed-key inputs
are never forwarded to the S3/SeaweedFS backend and cannot produce a 5xx response.
The validation policy SHALL be equivalent to `assertObjectKey` in
`services/adapters/src/storage-bucket-object-ops.mjs`.

#### Scenario: GET with a path-traversal key returns 400, not 5xx

- **WHEN** a caller issues a GET for an object whose key contains `../` (e.g.
  `../../etc/passwd` or the URL-encoded form `..%2F..%2Fetc%2Fpasswd`)
- **THEN** the API returns HTTP 400 with error code `INVALID_OBJECT_KEY`, never a
  5xx response, and no request is forwarded to the storage backend

#### Scenario: PUT with a backslash or leading-slash key returns 400

- **WHEN** a caller issues a PUT with an object key that contains a backslash or
  starts with `/`
- **THEN** the API returns HTTP 400 with error code `INVALID_OBJECT_KEY` before any
  backend or database interaction occurs

#### Scenario: Request with malformed percent-encoding returns 400, not 500

- **WHEN** a caller supplies an object key whose percent-encoding is malformed
  (e.g. `key%GGname`)
- **THEN** the API returns HTTP 400 with error code `INVALID_OBJECT_KEY`, not HTTP
  500 or 502

#### Scenario: Valid nested key is accepted without error

- **WHEN** a caller supplies a valid nested object key such as `folder/object.bin`
- **THEN** the handler does not reject it and proceeds to the bucket-ownership gate
  and backend call as normal
