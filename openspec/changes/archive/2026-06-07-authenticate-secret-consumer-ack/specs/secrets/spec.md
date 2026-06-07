## ADDED Requirements

### Requirement: Consumer-ack requires authenticated service identity

The system SHALL require a verified service identity (mTLS client certificate or short-lived service token) before executing any DB operation in the consumer-ack action. The system SHALL extract the authenticated principal from the verified credential and SHALL NOT accept `consumerId`, `secretPath`, or `vaultVersion` as authoritative identity from the caller.

#### Scenario: Unauthenticated ack is rejected before any DB write

- **WHEN** a caller invokes the secret-consumer-ack action without a valid service credential
- **THEN** the system returns HTTP 401 before executing any `confirmPropagation` or `insertRotationEvent` call

#### Scenario: Authenticated consumer with valid registration succeeds

- **WHEN** a caller presents a valid service credential whose authenticated identity matches the registered `consumerId` for the given `(secretPath, vaultVersion)`
- **THEN** the system confirms propagation and emits the audit event attributed to the authenticated identity

### Requirement: Consumer-ack validates registry membership and tenant consistency

The system SHALL verify that `(secretPath, consumerId)` is registered in `secret_consumer_registry` before confirming propagation. The system SHALL verify that `secret_version_states.tenant_id` for the given `(secretPath, vaultVersion)` matches the registered consumer's tenant. The system SHALL reject with 403 and emit no audit event if either verification fails.

#### Scenario: Unregistered consumer is rejected with 403

- **WHEN** a caller presents a valid service credential but the claimed `consumerId` is not registered for `secretPath` in `secret_consumer_registry`
- **THEN** the system returns HTTP 403
- **AND** no `confirmPropagation` DB write is executed
- **AND** no audit event or platform event is emitted

#### Scenario: Tenant mismatch is rejected with 403

- **WHEN** a caller presents a valid service credential and `consumerId` is registered, but `secret_version_states.tenant_id` for `(secretPath, vaultVersion)` does not match the registered consumer's tenant
- **THEN** the system returns HTTP 403
- **AND** no propagation state is modified

### Requirement: Audit events are attributed to the authenticated identity

The system SHALL set `actorId` in `insertRotationEvent` to the authenticated service principal resolved from the verified credential. The system SHALL NOT set `actorId` to the caller-supplied `consumerId` parameter.

#### Scenario: Forged actor identity is rejected

- **WHEN** a caller supplies a `consumerId` in the request that differs from the authenticated service principal
- **THEN** the system uses the authenticated principal as `actorId` in any audit event, not the caller-supplied value
