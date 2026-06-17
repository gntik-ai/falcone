## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: create a project with two environments (e.g. prod + staging), assert each has an isolated DB/bucket/topics/secrets set and that data in one is not visible in the other. Confirm RED (no environment entity today).

## 2. Add environment isolation

- [ ] 2.1 Introduce a first-class environment entity/model and an `environment` dimension on the project/workspace create flow.
- [ ] 2.2 Provision an isolated resource set (DB, bucket, topics, secrets) per environment.

## 3. Verify

- [ ] 3.1 Re-run the environment black-box test — confirm multiple isolated environments per project work.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
