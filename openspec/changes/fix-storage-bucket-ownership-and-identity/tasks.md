## 1. Failing black-box test

- [ ] 1.1 Add a black-box test: Tenant B's credential lists/reads Tenant A's bucket/workspace by id, asserting HTTP 403. Confirm RED.
- [ ] 1.2 Add a black-box test: a per-tenant storage credential cannot reach another tenant's prefix.

## 2. Fix storage handlers + identity

- [ ] 2.1 In `storage-handlers.mjs`, resolve the bucket/workspace owner and compare to `identity.tenantId`; return HTTP 403 on mismatch on every storage route.
- [ ] 2.2 Provision per-tenant SeaweedFS identities and bucket policies (or server-enforced per-tenant prefixes); stop issuing a platform-wide admin key for tenant I/O.

## 3. Verify

- [ ] 3.1 Re-run the cross-tenant black-box test — confirm a tenant lists/reads only its own buckets/objects.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
