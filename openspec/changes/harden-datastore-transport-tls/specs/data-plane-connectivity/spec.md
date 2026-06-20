## ADDED Requirements

### Requirement: Datastore connections are TLS-capable and configured from the environment

Every application-layer connection to a datastore (Postgres, the document store over the MongoDB wire protocol, and Kafka) SHALL be constructed so that transport encryption can be enabled from the environment, without code changes, via a single shared resolver. When TLS is requested for a connection, the corresponding client SHALL negotiate TLS; when no TLS is requested, the connection SHALL remain plaintext so existing development and test deployments are unaffected.

#### Scenario: Postgres TLS requested via PGSSLMODE

- **WHEN** a Postgres pool or client is created with `PGSSLMODE=require` (or `verify-ca`/`verify-full`) in the environment
- **THEN** the client is configured with a TLS `ssl` option so the connection is encrypted (not plaintext)

#### Scenario: Mongo and Kafka TLS requested via environment

- **WHEN** the document-store client is created with `MONGO_TLS` truthy, or a Kafka client is created with `KAFKA_SSL` truthy
- **THEN** the respective client is configured for TLS (and SASL when Kafka SASL variables are present)

#### Scenario: Verification requested in production without a CA fails closed

- **WHEN** `NODE_ENV=production` and a connection requests certificate verification (`PGSSLMODE=verify-ca`/`verify-full`, or Mongo/Kafka verifying TLS) but the configured CA file is missing or unreadable
- **THEN** the resolver throws and the affected process fails to start, rather than silently connecting plaintext or with verification disabled

#### Scenario: No TLS configured keeps the plaintext default

- **WHEN** no TLS environment variables are set (the dev/kind default)
- **THEN** the resolver returns no TLS configuration and connections are established in plaintext, preserving current behavior

#### Scenario: Verification disabled honors the unverified TLS mode

- **WHEN** `PGSSLMODE=require` is set without a CA file
- **THEN** the connection is encrypted with certificate verification disabled (`rejectUnauthorized=false`), and the process does not fail closed
