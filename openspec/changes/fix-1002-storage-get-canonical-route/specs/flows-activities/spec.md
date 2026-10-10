## MODIFIED Requirements

### Requirement: storage.get reads the canonical object envelope

The storage.get activity MUST request the control plane's registered full-object GET route and return bounded, byte-preserving object content. The public storageGetOutputSchema MUST remain unchanged.

#### Scenario: Canonical, execution-scoped request

- **GIVEN** bucket ID b, object key k, and an execution-scoped credential
- **WHEN** storage.get runs
- **THEN** it sends exactly one GET to `{base}/v1/storage/buckets/{enc(b)}/objects/{enc(k)}` with independently URI-encoded parameters
- **AND** it sends no `/download` suffix or Range header
- **AND** it uses only the existing Bearer header from credential.apiKey
- **AND** resolving its URL against the real routes table with the server's template-matching rule selects storageGetObject

#### Scenario: Binary envelope output

- **GIVEN** a 200 JSON envelope with a string contentBase64 containing arbitrary binary bytes, including non-UTF-8 bytes, and contentType image/png
- **WHEN** storage.get reads the response
- **THEN** output.body equals contentBase64 without re-encoding and decodes byte-identically to the object bytes
- **AND** output.contentType equals image/png
- **AND** the output validates against storageGetOutputSchema
- **AND** an absent or non-string contentType defaults to application/octet-stream

#### Scenario: Malformed success response

- **GIVEN** a 200 body that is invalid JSON or lacks a string contentBase64
- **WHEN** storage.get reads the response
- **THEN** it throws non-retryable UPSTREAM_ERROR with a generic message
- **AND** it never returns base64 of the raw response or exposes its contents in an error

#### Scenario: Missing object and cross-tenant denial

- **GIVEN** either a missing object with 404 OBJECT_NOT_FOUND or tenant B requesting tenant A's bucket with 404 BUCKET_NOT_FOUND
- **WHEN** storage.get receives the response
- **THEN** it throws non-retryable OBJECT_NOT_FOUND
- **AND** it returns no object bytes or metadata and includes none in the activity error message
- **AND** the control-plane ownership gate prevents a cross-tenant request from reaching object storage

#### Scenario: Existing classifications and payload bound

- **WHEN** the upstream returns 403, 429/503, or another 4xx/5xx
- **THEN** classifications remain respectively non-retryable FORBIDDEN, retryable UPSTREAM_UNAVAILABLE, or non-retryable UPSTREAM_ERROR
- **AND** successful output remains subject to the existing serialized MAX_OUTPUT_BYTES limit and non-retryable PAYLOAD_TOO_LARGE failure
