## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: subscribe to a Mongo collection, delete a doc via the driver, assert a `delete` frame is delivered to the owning tenant's subscriber. Confirm RED (no frame today).
- [ ] 1.2 Add a cross-tenant probe asserting another tenant's subscriber does NOT receive the delete.

## 2. Fix delete delivery

- [ ] 2.1 In the realtime executor delete branch, key the event off the change-stream `documentKey` plus the stored `tenantId` (or a pre-image lookup) rather than `fullDocumentBeforeChange`.

## 3. Verify

- [ ] 3.1 Re-run the realtime black-box test — confirm the owning tenant receives its own `delete` events and cross-tenant deletes are not delivered.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
