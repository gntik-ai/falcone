## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: create a table via the DDL API, then insert via the service key, asserting success (not 404 TABLE_NOT_FOUND). Confirm RED.
- [ ] 1.2 Add a black-box test asserting the created table CRUD works only for the issuing tenant.

## 2. Fix DDL grants + RLS

- [ ] 2.1 In the DDL/provisioning path, emit GRANTs to the api-key roles (`falcone_service`/`falcone_anon`) on each created table.
- [ ] 2.2 Install the tenant RLS policy on the new table as part of creation (ties into A3).

## 3. Verify

- [ ] 3.1 Re-run the round-trip black-box test — confirm create-then-CRUD works for the issuing tenant.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
