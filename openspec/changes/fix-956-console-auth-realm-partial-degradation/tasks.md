## 1. Tests

- [x] 1.1 Add focused Auth/IAM console tests for partial failures, localized attribution, and
  section-only retries.

## 2. Implementation

- [x] 2.1 Replace the shared realm inventory load with independently guarded users, roles,
  scopes, and clients loads.
- [x] 2.2 Render loading, error, empty, and data states per realm section.
- [x] 2.3 Limit retry controls to retryable errors and their failed endpoint.

## 3. Specification

- [x] 3.1 Add the web-console requirement delta for partial realm inventory degradation.

## 4. Verification

- [ ] 4.1 Run the focused web-console test and typecheck. These require the sandbox to permit
  pnpm to spawn Node.
- [x] 4.2 Run `openspec validate fix-956-console-auth-realm-partial-degradation --strict`.
