## 1. Reproduce / Encode

- [x] 1.1 Confirm current runtime returns idempotent `200 { deleted: true }` while OpenAPI declares
  `204` / `404`.
- [x] 1.2 Add a focused unit regression for existing, missing, and invalid-name DELETE behavior.
- [x] 1.3 Assert the contract remains `204` / `404` and does not document a JSON `200` response.

## 2. Implement

- [x] 2.1 Validate `secretName` in `secretDelete`.
- [x] 2.2 Probe existence at the verified tenant/workspace path before deleting.
- [x] 2.3 Return `404 SECRET_NOT_FOUND` without calling delete when absent.
- [x] 2.4 Return `204` with no body after deleting an existing secret.

## 3. Docs / Wire

- [x] 3.1 Update workspace-secret docs and frontend client comment to state the contract-strict
  DELETE behavior.
- [x] 3.2 Update the shared web-console request helper to resolve `204`/empty JSON responses as
  `null`, preserving the delete flow against the contract-strict backend response.
- [x] 3.3 Keep OpenAPI, SDK, and route catalog unchanged.

## 4. Verify

- [x] 4.1 Run focused unit and black-box workspace-secret tests.
- [x] 4.2 Run contract/OpenAPI validation and public API generation drift check.
- [x] 4.3 Run OpenSpec validation.
