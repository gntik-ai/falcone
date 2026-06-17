# document-store — spec delta for fix-ferretdb-gateway-authentication

## MODIFIED Requirements

### Requirement: FerretDB gateway accepts the control-plane's Mongo credentials

The system SHALL configure the FerretDB gateway and the control-plane
`MONGO_USER`/`MONGO_PASSWORD` to reference the same coherent identity so that
the MongoDB wire-protocol handshake succeeds on every startup.

#### Scenario: Control-plane authenticates to FerretDB on startup

- **WHEN** the control-plane starts with `MONGO_USER` and `MONGO_PASSWORD` set
- **THEN** the connection to the FerretDB gateway MUST complete the SASL handshake
  without a `HandshakeError` and MUST NOT log `MongoServerError`

#### Scenario: Browse endpoint returns database list

- **WHEN** a superadmin calls `GET /v1/mongo/databases`
- **THEN** the response MUST be **200** with a JSON array of database names

#### Scenario: Document round-trip succeeds

- **WHEN** a caller inserts a document via the Mongo data API and then lists documents
  in the same collection
- **THEN** the inserted document MUST appear in the list response; both calls MUST
  return 2xx

#### Scenario: MongoDB database provisioning succeeds

- **WHEN** a caller sends `POST /v1/workspaces/{workspaceId}/databases` with body
  `{ "engine": "mongodb" }`
- **THEN** the response MUST be **2xx** and a new document database MUST be provisioned

## ADDED Requirements

### Requirement: FerretDB gateway fails closed on authentication error at startup

The system SHALL add a startup check (init-container or readiness probe) that
verifies the Mongo connection handshake succeeds before the gateway or the
control-plane's Mongo client is marked ready. If the check fails the component
MUST remain `NotReady` and the liveness/readiness probe MUST report failure so
that Kubernetes does not route traffic to a broken instance.

#### Scenario: Broken auth credentials keep FerretDB NotReady

- **WHEN** the FerretDB gateway starts with invalid or mismatched credentials
- **THEN** the pod's readiness probe MUST fail and the pod MUST remain `NotReady`
  so that no traffic is routed to it
