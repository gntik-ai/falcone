## 1. Source implementation

- [x] 1.1 Reproduce a successful purge that leaves secret data readable before changing source.
- [x] 1.2 Add recursive metadata destruction, verification, failure disclosure, idempotency, and scope guards at the public secret-store seam.
- [x] 1.3 Gate tenant and workspace row deletion on secret teardown after runtime cleanup; preserve retry and disabled-backend disclosure.
- [x] 1.4 Share one store/auth provider between function and lifecycle handlers.
- [x] 1.5 Extend the published OpenAPI completion and failure contracts.

## 2. Verification

- [x] 2.1 Run fake-fetch tests for version destruction, recursion, re-listing, delete/list failures, cancellation, idempotency, and root guards.
- [x] 2.2 Run public-handler tests for tenant/workspace isolation, failed teardown and retry, retained rows, pending cleanup, disabled backend, and redaction.
- [x] 2.3 Verify one Kubernetes-auth login/provider across both handler modules.
- [ ] 2.4 Run dependency-backed handler suites and OpenAPI validation in PR CI; local handler checks use the optional external SDK boundary loader because installed packages are absent. The existing HTTP-backed secret suite also needs an environment that permits local listeners.
- [ ] 2.5 In the release gate, template deployment revision `3be423c6`, verify metadata list/delete policy parity and the control-plane auth role, and exercise live data/metadata 404s after teardown.
- [x] 2.6 Reproduce and correct the stale completed-response expectations in `bbx-933-aggregate-completed-response-35`; explicitly inject a disabled secret backend and preserve schema validation, including rejection of missing secret disclosure fields. The extracted public-handler assertions pass locally; the full Ajv-backed file remains covered by item 2.4.
- [x] 2.7 Add operation/status-only teardown diagnostics after failing public-store and handler tests; run all 25 scoped teardown tests, including redaction.
- [x] 2.8 Reproduce the stale published family contracts with a failing contract test, regenerate public API artifacts, and verify both family contracts disclose secret completion and failure. All 26 scoped teardown tests and public API alignment pass; all family contracts, the route catalog, and docs match generator output. Offline generation uses a temporary parsed-YAML adapter and handler tests use synchronous SDK boundary hooks because sandbox subprocesses are restricted. Dependency-backed validation remains in item 2.4; the broader catalog test also needs the absent `cel-js` package.
