## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: insert a document, then `GET …/documents/{insertedId}`, asserting the document is found. Confirm RED (`{found:false}` today).
- [ ] 1.2 Add a black-box test: DELETE by a real id returns `deleted:1` and the document is gone.

## 2. Fix id coercion

- [ ] 2.1 In the mongo executor by-id handlers, coerce `_id` to `ObjectId` (with a string fallback for ids that are not valid ObjectIds) before querying.

## 3. Verify

- [ ] 3.1 Re-run the round-trip black-box test — confirm get/update/replace/delete by id work and DELETE removes the document.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
