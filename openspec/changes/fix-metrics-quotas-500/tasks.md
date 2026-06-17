# Tasks — fix-metrics-quotas-500

## Investigation
- [ ] Examine `metrics-handlers.mjs` line 49 — what query does `tenantLimits` issue?
- [ ] Determine the missing relation (`42P01`) — is it a missing migration?
- [ ] Determine why `Forbidden` is thrown — wrong DB role or missing GRANT?

## Implementation
- [ ] Add the missing migration to create the relation.
- [ ] Fix the GRANT/permission issue so the metrics handler's DB role can query it.

## Verification
- [ ] `GET /v1/metrics/tenants/{id}/quotas` → 200 with quota data.
- [ ] Run `bash tests/blackbox/run.sh`.
- [ ] Run `/opsx:verify fix-metrics-quotas-500`.

## Archive
- [ ] `/opsx:archive fix-metrics-quotas-500`
