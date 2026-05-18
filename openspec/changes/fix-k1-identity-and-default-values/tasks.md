## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/workspace-docs-service/actions/workspace-docs.integration.test.mjs`
      that calls `GET /docs` without `X-Correlation-Id` and asserts the
      response header is a v4 UUID, not the literal `corr-missing`.
- [ ] 1.2 [test] Add a case to `src/doc-audit.test.mjs` that calls
      `recordAccess(..., tenantId=undefined)` and asserts it throws,
      rather than silently writing `'unknown'`.
- [ ] 1.3 [test] Add a case calling `GET /docs` with no `X-API-Version`
      header and asserting `400 UNSUPPORTED_API_VERSION`.
- [ ] 1.4 [test] Add a case importing `src/config.mjs` with
      `NODE_ENV=production` and empty `WORKSPACE_DOCS_DB_URL`; assert it
      throws at module load.

## 2. Implementation

- [ ] 2.1 [fix] Replace the `'corr-missing'` fallback at
      `actions/workspace-docs.mjs:69` with `randomUUID()` from `node:crypto`.
- [ ] 2.2 [fix] Remove the `tenantId='unknown'` default at
      `src/doc-audit.mjs:1`; make `tenantId` a required positional/named
      parameter and throw `MISSING_TENANT_ID` if absent.
- [ ] 2.3 [fix] Tighten `actions/workspace-docs.mjs:34-40` to require the
      `X-API-Version` header; remove the missing-header bypass.
- [ ] 2.4 [fix] Add a production-only assertion at `src/config.mjs:11-12`
      that throws when `WORKSPACE_DOCS_DB_URL` or `KAFKA_BROKERS` is
      empty and `NODE_ENV === 'production'`.
- [ ] 2.5 [fix] Enforce a signed-context check on `params.auth` at the
      action edge (`actions/workspace-docs.mjs:27-32`); reject unsigned
      auth payloads with `403 FORBIDDEN`.

## 3. Validation

- [ ] 3.1 [test] Re-run `pnpm test` for the K1 package and `openspec
      validate fix-k1-identity-and-default-values --strict`; both green.
- [ ] 3.2 [docs] Document the new header / env-var requirements in
      `services/workspace-docs-service/README.md`.
