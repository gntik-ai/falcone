## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: provision a measurable resource for a tenant, then `GET /v1/tenants/{t}/plan/consumption`, asserting the relevant dimension is non-zero (not `null`/`NO_QUERY_MAPPING`). Confirm RED.
- [ ] 1.2 Add a black-box test: exceeding a hard limit is enforced.

## 2. Fix consumption mappings

- [ ] 2.1 Implement the missing consumption query mappings so each dimension measures real resource counts.
- [ ] 2.2 Wire the measured values into soft/hard limit enforcement.

## 3. Verify

- [ ] 3.1 Re-run the consumption black-box test — confirm consumption reflects real counts and limits enforce.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
