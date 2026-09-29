## Implementation

- [x] Resolve tenant auth target from an active tenants row for login, refresh, and logout.
- [x] Preserve platform defaults when tenant ID is absent.
- [x] Carry tenant ID from login URL through the browser session and later token operations.
- [x] Update OpenAPI schemas and route notes.
- [x] Add focused backend and web regression tests.

## Verification

- [x] Run available self contained Node tests.
- [ ] Run OpenAPI contract tests and web tests in PR CI with installed dependencies.
- [ ] Revalidate signup, login, tenant access, logout, and rejected refresh in staging after approval.
