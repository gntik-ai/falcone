# Restore E2E Suite

This suite validates functional restore flows for sandbox tenants.

## Run

```bash
pnpm test:e2e:restore
```

Run a single scenario:

```bash
node --test tests/e2e/workflows/restore/e1-full-restore-empty-tenant.test.mjs
```

## Required environment

- `RESTORE_TEST_API_BASE_URL` — sandbox APISIX base URL
- `RESTORE_TEST_AUTH_TOKEN` — JWT for a service account with restore scopes

## Optional environment

- `RESTORE_TEST_PARALLELISM=true`
- `RESTORE_TEST_DOMAINS_ENABLED=iam,postgres_metadata,kafka,storage`
- `RESTORE_TEST_OW_ENABLED=true|false`
- `RESTORE_TEST_MONGO_ENABLED=true|false`
- `RESTORE_TEST_REPORT_OUTPUT=restore-test-report.json`
- `RESTORE_TEST_SCENARIO_TIMEOUT_MS=120000`
- `RESTORE_TEST_CORRELATION_PREFIX=restore-e2e`

## Troubleshooting

- If optional domains are disabled, E5 may skip.
- If cleanup leaves residual tenants, use `tests/e2e/fixtures/restore/cleanup.mjs` helpers.
- Reports are written as JSON plus a `.txt` summary.
