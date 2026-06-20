## ADDED Requirements

### Requirement: A production deployment profile enables in-transit encryption to all datastores

The deployment SHALL provide a production hardening values profile that enables in-transit encryption for every datastore connection. When that profile is applied, the control-plane, executor, and worker pods SHALL receive the TLS environment that the application now honors, the chart's datastore TLS toggles SHALL be enabled, and the CA material needed for certificate verification SHALL be mounted into the pods from a configurable secret.

#### Scenario: Production overlay sets the hardened transport environment

- **WHEN** the production hardening values profile is applied
- **THEN** the control-plane/executor/worker pods receive `PGSSLMODE=verify-full`, `MONGO_TLS`, and `KAFKA_SSL`, and the Keycloak JWKS and S3 endpoints are `https`

#### Scenario: Production overlay enables the datastore TLS chart toggles

- **WHEN** the production hardening values profile is applied
- **THEN** `ferretdb.tls.enabled`, `seaweedfs` inter-component security (`enableSecurity`), and the SeaweedFS TLS bootstrap are enabled

#### Scenario: CA material is mounted for verification

- **WHEN** the production hardening profile is applied with a CA secret configured
- **THEN** the CA bundle is mounted into the control-plane/executor/worker pods and the `PGSSLROOTCERT`/`KAFKA_SSL_CA_FILE`/`MONGO_TLS_CA_FILE`/`NODE_EXTRA_CA_CERTS` environment points at the mounted path

#### Scenario: Base profile is unchanged

- **WHEN** the base/kind values are applied without the production overlay
- **THEN** no TLS environment is injected and connections remain plaintext, preserving the current development posture
