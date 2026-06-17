# realtime Specification

## Purpose
TBD - created by archiving change fix-realtime-refresh-identity-stability. Update Purpose after archive.
## Requirements
### Requirement: refreshToken MUST reject tokens whose tenant does not match the session

The system SHALL verify that `claims.tenant_id` in the new Bearer token equals `session.tenantId`
before applying any state update in `refreshToken`; if the values differ the system SHALL close
the session and return an error indicating identity mismatch, without mutating any session state.

This requirement is unchanged in behavior; it is re-stated here to confirm it applies equally
when the realtime event source is Postgres logical replication rather than MongoDB change streams.

#### Scenario: Cross-tenant token rejected on refresh (bbx-refresh-tenant-drift)

- **WHEN** a caller invokes `refreshToken` for session S (created for tenant A, actor X) with a
  validly-signed token whose `tenant_id` is tenant B (a different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and no
  subsequent scope checks run under tenant B's identity

### Requirement: refreshToken MUST reject tokens whose actor does not match the session

The system SHALL verify that `claims.sub` in the new Bearer token equals `session.actorIdentity` before applying any state update in `refreshToken`; if the values differ the system SHALL close the session and return an error indicating identity mismatch.

#### Scenario: Actor drift rejected on refresh

- **WHEN** a caller invokes `refreshToken` for session S (created for actor X in tenant A) with a validly-signed token whose `sub` is actor Y (a different actor, same or different tenant)
- **THEN** the system closes session S, returns an error with code `IDENTITY_MISMATCH`, and no scope check or publish-guard for session S evaluates actor Y's claims

### Requirement: refreshToken MUST NOT mutate session identity anchors

The system SHALL ensure that after a successful `refreshToken` call the DB columns `tenant_id` and `actor_identity` for the session row remain equal to their values at session creation time, and `session.tenantId` and `session.actorIdentity` in memory remain unchanged.

#### Scenario: Successful refresh preserves session identity anchors

- **WHEN** a caller invokes `refreshToken` for session S with a validly-signed token that matches `session.tenantId` and `session.actorIdentity`
- **THEN** the session DB row `tenant_id` and `actor_identity` columns are unchanged, `session.tenantId` and `session.actorIdentity` in memory are unchanged, and the session status becomes `ACTIVE`

### Requirement: verifyLocally MUST enforce issuer binding on every token

The system SHALL pass the configured `KEYCLOAK_ISSUER` value as the `issuer` option to `jwtVerify` in `verifyLocally`; if the token's `iss` claim does not match, the system SHALL reject the token with `TOKEN_INVALID`.

#### Scenario: Token with wrong issuer is rejected (bbx-realtime-aud-binding)

- **WHEN** a caller presents a validly-signed RS256 token whose `iss` claim does not match `KEYCLOAK_ISSUER`
- **THEN** the realtime gateway rejects the token with an error code of `TOKEN_INVALID` and does not establish or refresh a session

### Requirement: verifyLocally MUST enforce audience binding on every token

The system SHALL pass the configured `KEYCLOAK_AUDIENCE` value as the `audience` option to `jwtVerify` in `verifyLocally`; if the token's `aud` claim does not include the expected audience, the system SHALL reject the token with `TOKEN_INVALID`.

#### Scenario: Token with wrong audience is rejected

- **WHEN** a caller presents a validly-signed RS256 token whose `aud` claim does not include the value of `KEYCLOAK_AUDIENCE`
- **THEN** the realtime gateway rejects the token with an error code of `TOKEN_INVALID` and does not establish or refresh a session

### Requirement: loadEnv MUST require KEYCLOAK_ISSUER and KEYCLOAK_AUDIENCE

The system SHALL fail startup with a descriptive error if `KEYCLOAK_ISSUER` or `KEYCLOAK_AUDIENCE` is absent or empty when `loadEnv` is called.

#### Scenario: Missing KEYCLOAK_ISSUER causes startup failure

- **WHEN** the realtime gateway starts with `KEYCLOAK_ISSUER` absent or empty
- **THEN** `loadEnv` throws an error naming the missing variable and the process does not proceed to serve requests

### Requirement: Tokens with matching issuer and audience MUST be accepted

The system SHALL accept a validly-signed RS256 token whose `iss` equals `KEYCLOAK_ISSUER` and whose `aud` includes `KEYCLOAK_AUDIENCE`, provided the token is not expired and the signature is valid.

#### Scenario: Valid token with correct issuer and audience is accepted

- **WHEN** a caller presents a validly-signed RS256 token with matching `iss` and `aud` claims and a valid expiry
- **THEN** the realtime gateway accepts the token and returns normalised claims

### Requirement: Realtime SSE MUST source change events from Postgres logical replication on the DocumentDB engine

The system SHALL, when the active document store is FerretDB v2 / DocumentDB-on-Postgres (where
`collection.watch()` returns CommandNotSupported code 115 and `collMod
changeStreamPreAndPostImages` returns UnknownBsonField code 40415), replace the
`collection.watch()` call in `apps/control-plane/src/runtime/realtime-executor.mjs` with a
Postgres logical replication slot consumer that reads WAL change records from the
`documentdb_data` tables via a `pgoutput`-plugin replication slot, decodes each record into the
existing `onChange` event shape `{ type, documentId, document }`, and delivers them to SSE
subscribers via the existing dispatcher without altering the SSE wire format or route shape.

Evidence: `apps/control-plane/src/runtime/realtime-executor.mjs:54` (`collMod
changeStreamPreAndPostImages`), `:66` (`collection.watch`), `:78–84` (`onChange` shape).

#### Scenario: SSE subscriber receives insert event from Postgres WAL

- **WHEN** a client subscribes to the SSE route for collection C under tenant T and a document is
  inserted into collection C in the DocumentDB engine
- **THEN** the WAL replication slot emits an INSERT record for the `documentdb_data` row, the
  decoder maps it to `{ type: 'insert', documentId, document }`, and the SSE stream delivers an
  event with `operationType: 'insert'` and `fullDocument` matching the inserted document

#### Scenario: SSE subscriber receives update event from Postgres WAL

- **WHEN** a client subscribes to the SSE route for collection C under tenant T and an existing
  document in collection C is updated
- **THEN** the WAL replication slot emits an UPDATE record (with full new row image), the decoder
  maps it to `{ type: 'replace', documentId, document }` reflecting the post-update state, and
  the SSE stream delivers the event to the subscribed client

#### Scenario: SSE subscriber receives delete event with prior document from Postgres WAL

- **WHEN** a client subscribes to the SSE route for collection C under tenant T and a document is
  deleted from collection C
- **THEN** the WAL replication slot emits a DELETE record carrying the complete OLD row (because
  `REPLICA IDENTITY FULL` is set on the table), the decoder extracts the prior document from
  the OLD row image, and the SSE stream delivers an event with `type: 'delete'` and `document`
  set to the prior document — `document` is NOT null for delete events

### Requirement: Realtime SSE MUST enforce tenant scoping via consumer-side filtering on the WAL tenantId column

The system SHALL, after reading WAL change records from the replication slot (which delivers rows
for ALL tenants), apply a consumer-side filter that discards any record whose decoded `tenantId`
column does not equal the subscribing session's `tenantId`, so that no cross-tenant document is
delivered to an SSE subscriber.

Evidence: `apps/control-plane/src/runtime/realtime-executor.mjs:59–65` — the old server-side
`$match` on `fullDocument.tenantId` / `fullDocumentBeforeChange.tenantId`; the WAL stream
carries all tenants' rows; per-database Postgres role scoping is NOT enforced on the
DocumentDB engine.

#### Scenario: Cross-tenant WAL record is discarded — Tenant B's event is not delivered to Tenant A's SSE stream

- **WHEN** Tenant A's SSE session is subscribed to collection C, and a document is written under
  Tenant B (the WAL record carries `tenantId = 'ten_B'` in the row data)
- **THEN** the realtime consumer discards the record (consumer-side filter: `row.tenantId !==
  session.tenantId`), and Tenant A's SSE stream does NOT receive that event

#### Scenario: Consumer-side filter passes only matching-tenant records to the SSE dispatcher

- **WHEN** the WAL stream delivers a batch containing records for tenants A, B, and C and the
  active SSE session is bound to tenant A
- **THEN** only records with `tenantId === 'ten_A'` are passed to the SSE dispatcher; records
  for tenants B and C are silently discarded with no error

### Requirement: documentdb_data tables MUST have REPLICA IDENTITY FULL set before the replication slot is consumed

The system SHALL, as part of the DocumentDB engine initialisation (chart init-container or
migration job), execute `ALTER TABLE documentdb_data.* REPLICA IDENTITY FULL` on all collection
tables in the `documentdb_data` schema, so that every DELETE WAL record carries the complete OLD
row image (enabling tenant-scoped delete event delivery and pre-image document extraction).

Evidence: `apps/control-plane/src/runtime/realtime-executor.mjs:54` — `collMod
changeStreamPreAndPostImages` was the MongoDB equivalent; with logical replication `REPLICA
IDENTITY FULL` is the replacement and is mandatory.

#### Scenario: DELETE WAL record carries complete OLD row image

- **WHEN** `REPLICA IDENTITY FULL` is set on a `documentdb_data` table and a row is deleted
- **THEN** the WAL DELETE record emitted by the replication slot contains the complete OLD row
  (all columns, including the BSON document payload and `tenantId`), not only the primary key

#### Scenario: Realtime engine rejects start if REPLICA IDENTITY is not FULL

- **WHEN** the realtime engine starts and detects that any watched `documentdb_data` table does
  NOT have `REPLICA IDENTITY FULL`
- **THEN** the engine logs an error identifying the misconfigured table and refuses to deliver
  delete events (or halts subscription) until the condition is corrected

### Requirement: Realtime SSE MUST preserve the tenant-facing route contract and onChange event shape after the logical replication migration

The system SHALL preserve the existing SSE route path, HTTP method, query parameters, and event
shape (`type: insert|update|replace|delete`, `documentId`, `document`) used by the `onChange`
callback in `realtime-executor.mjs` after replacing `collection.watch()` with the Postgres
logical replication consumer, so that tenant-facing SSE consumers and the SSE dispatcher require
no changes.

Evidence: `apps/control-plane/src/runtime/realtime-executor.mjs:78–84` — `onChange` shape;
SSE route `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes`.

#### Scenario: SSE route path and onChange event shape are unchanged after migration

- **WHEN** a client subscribes to `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes`
  after the logical replication migration
- **THEN** the HTTP route responds with `Content-Type: text/event-stream` and each event payload
  contains `type`, `documentId`, and `document` fields identical in name and type to the
  pre-migration shape produced by `realtime-executor.mjs:79–84`

#### Scenario: Existing E2E tenant-isolation test passes on the FerretDB stack

- **WHEN** `tests/e2e/realtime/tenant-isolation.test.mjs` is executed against a Falcone instance
  backed by FerretDB v2 / DocumentDB-on-Postgres with the Postgres logical replication event
  source active
- **THEN** all assertions pass: SSE delivers insert/update/delete events to the correct tenant's
  subscriber and does not leak events to a cross-tenant subscriber

### Requirement: Realtime SSE session teardown MUST close the WAL consumer cursor and release the replication connection

The system SHALL, on SSE session close or client disconnect, stop consuming WAL records for that
session, release any per-session in-memory LSN cursor, and not leave a dangling replication
connection or open slot reference, so that no resource leak occurs over time.

#### Scenario: WAL consumer is released on SSE session close

- **WHEN** an SSE client disconnects from the realtime route
- **THEN** the engine stops delivering WAL records to that session's handler and releases the
  associated in-memory cursor; no further WAL decoding is performed for that session

### Requirement: Mongo collection delete events MUST be delivered to the owning tenant

The system SHALL deliver collection `delete` events to the owning tenant's subscribers, keyed off the change pre-image so the event can be tenant-scoped. On the live realtime path — Postgres logical replication over the DocumentDB engine (add-ferretdb-realtime-cdc-remediation, #460), which replaced the MongoDB change-stream engine — `REPLICA IDENTITY FULL` makes the delete pre-image (`fullDocumentBeforeChange`) available and the executor filters on its `tenantId` consumer-side, so deletes are delivered and never cross tenants.

#### Scenario: Owning tenant's subscriber receives a delete frame

- **WHEN** a tenant subscribes to a collection and a document in that collection is deleted via the driver
- **THEN** the owning tenant's subscriber receives a `delete` frame for that document

#### Scenario: Cross-tenant deletes are not delivered

- **WHEN** a document belonging to Tenant A is deleted
- **THEN** Tenant B's subscriber receives no `delete` frame for that document

