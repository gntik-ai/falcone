# Tasks

## 1. Runtime

- [x] Update `iamCreateUser` to use documented `IamUserCreateRequest` fields.
- [x] Preserve legacy create-user payload compatibility for existing callers.
- [x] Reject unsupported documented create fields instead of silently dropping them.
- [x] Preserve multi-valued IAM attributes when building Keycloak user payloads.

## 2. Tests

- [x] Add handler-level coverage for attributes, realmRoles, and bootstrapCredentials.
- [x] Add compatibility coverage for legacy roles/credentials.
- [x] Add coverage that unsupported documented fields fail before mutation.
- [x] Add attribute-normalization coverage for OpenAPI array values.

## 3. Documentation

- [x] Document the create-user contract-field mapping and unsupported fields.
- [x] Materialize the issue's proposed OpenSpec delta.

## 4. Verification

- [x] Run focused local regression tests.
- [x] Run the relevant broader regression slice.
- [x] Verify generated contract artifacts produce no diff.
- [x] Obtain independent verifier NOT_CONFIRMED.
- [x] Obtain independent reviewer APPROVE.
