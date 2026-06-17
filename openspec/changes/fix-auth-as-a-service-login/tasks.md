## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: create a platform user (admin API), then attempt `POST /v1/auth/login-sessions`, asserting a token is returned (not `invalid_grant "Account is not fully set up"`). Confirm RED.
- [ ] 1.2 Add a black-box test: a self-service signup can subsequently log in and make an authorized call.

## 2. Fix direct-grant flow

- [ ] 2.1 Correct the `in-falcone-console` client direct-grant flow / consent configuration so a fully-set-up user can authenticate via ROPC.

## 3. Verify

- [ ] 3.1 Re-run the login black-box tests — confirm a freshly created user and a signup both obtain a token and make an authorized call.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
