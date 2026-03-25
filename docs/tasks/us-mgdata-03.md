# US-MGDATA-03 — MongoDB Data API scoped credentials, normalized errors, and document auditability

## Scope

Extend the MongoDB Data API surface introduced in US-MGDATA-01 and US-MGDATA-02 with:

- scoped MongoDB Data API credentials limited by logical database and collection
- normalized document-data error classes with safe corrective metadata
- actor / tenant / workspace / origin audit capture for document operations
- plan-based guardrails for advanced aggregation and transaction workloads
- backend and admin-facing usage examples for the new governance surface

## Delivered increment

### Contract and service map

- Extended `mongo_data_request` metadata so plan-policy governance is explicit in the internal request envelope.
- Refined MongoDB Data API contract versioning notes to cover scoped credentials, normalized error metadata, and audit traceability.
- Added MongoDB Data API credential resource taxonomy for the public route inventory.

### Public API

Added four Mongo credential routes:

- `listMongoDataCredentials`
- `createMongoDataCredential`
- `getMongoDataCredential`
- `revokeMongoDataCredential`

New resource type:

- `mongo_data_credential`

Published additive credential and audit schemas:

- `MongoDataCredentialScope`
- `MongoDataCredentialCreateRequest`
- `MongoDataCredentialRecord`
- `MongoDataCredentialCollection`
- `MongoDataCredentialSecretEnvelope`
- `MongoDataAuditSummary`

### Planner / adapter safeguards

- Added `buildMongoDataScopedCredential()` for collection-aware API key/token scope planning.
- Normalized provider duplicate-key, validation, permission, not-found, capability, and payload failures into stable Mongo error classes with safe remediation hints.
- Captured request/actor/tenant/workspace/origin metadata in trace and audit helper output.
- Added plan-policy enforcement for aggregation and transaction limits, including the ability to disable advanced operations per plan.

### Documentation and validation

- Expanded MongoDB Data API reference docs with credential, error, audit, and usage-example coverage.
- Added unit, adapter, contract, and resilience coverage for scoped credentials, plan-policy enforcement, and normalized errors.

## Known risk carried forward

US-DX-01 is still pending, so change streams remain bridge-oriented rather than end-to-end delivery complete. Error examples are now normalized and safer, but final gateway-side error envelope shaping still depends on the control-plane integration layer.
