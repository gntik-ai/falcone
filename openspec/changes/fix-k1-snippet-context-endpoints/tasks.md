## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/workspace-docs-service/src/snippet-context-builder.test.mjs`
      asserting the `webhooks` snippet endpoint resolves to
      `${baseUrl}/v1/webhooks/subscriptions` (matching F3 OpenAPI),
      not `${baseUrl}/v1/webhooks`.
- [ ] 1.2 [test] Add a case asserting that, with
      `realtimeEndpoint` absent on a capability and
      `WORKSPACE_DOCS_REALTIME_BASE_URL` unset, the builder throws
      `MISSING_REALTIME_ENDPOINT` instead of substituting the API host.
- [ ] 1.3 [test] Add a case to
      `services/workspace-docs-service/src/rotation-procedure-section.test.mjs`
      passing `workspaceContext` with `baseUrl=null`; assert it throws
      `MISSING_BASE_URL`, not `https://api.example.test/...`.

## 2. Implementation

- [ ] 2.1 [fix] In `snippet-context-builder.mjs:40-44`, replace the
      hard-coded webhook/scheduling paths with values sourced from
      `apiSurface.routes` (falling back to
      `/v1/webhooks/subscriptions` and `/v1/schedules`).
- [ ] 2.2 [fix] In `snippet-context-builder.mjs:29`, remove the scheme-
      substitution default; require either `capability.realtimeEndpoint`
      or `config.realtimeBaseUrl` (from
      `WORKSPACE_DOCS_REALTIME_BASE_URL`); throw `MISSING_REALTIME_ENDPOINT`
      if neither is present.
- [ ] 2.3 [fix] In `rotation-procedure-section.mjs:2`, remove the
      `'https://api.example.test'` fallback; assert `baseUrl` is a
      non-empty string and throw `MISSING_BASE_URL` otherwise.

## 3. Validation

- [ ] 3.1 [test] Re-run K1 unit suite and `openspec validate
      fix-k1-snippet-context-endpoints --strict`; both green.
- [ ] 3.2 [docs] Document the new `WORKSPACE_DOCS_REALTIME_BASE_URL`
      env var in `services/workspace-docs-service/README.md`.
