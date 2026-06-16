## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: `POST /v1/workspaces`, wait for the saga, then assert the backing `wsdb_*` physical database exists and the data API connects to it. Confirm RED (registry row only today).

## 2. Fix the saga

- [ ] 2.1 Complete the workspace provisioning saga so it creates the `wsdb_*` Postgres database (and other backing resources) and only marks the registry row ready when the DB exists.

## 3. Verify

- [ ] 3.1 Re-run the provisioning black-box test — confirm a new workspace gets a real, isolated database the data API uses, with no orphaned registry row.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
