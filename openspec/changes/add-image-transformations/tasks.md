# Tasks — add-image-transformations

- [ ] **T01** Confirm baseline green.
- [ ] **T02** Extend `apps/control-plane/openapi/families/storage.openapi.json` with the
      reserved transform query parameters and `.../transformations` admin endpoints.
- [ ] **T03** Implement `services/adapters/src/storage-transformations.mjs` using `sharp`
      (libvips); include canonical-string serialiser, HMAC signer/verifier, derivative
      cache I/O against the underlying storage provider.
- [ ] **T04** Branch `storage-bucket-object-ops.mjs` on presence of any transform query
      param; dispatch to the transform module; pass cache-key + Cache-Control headers
      back to the caller.
- [ ] **T05** Migration `NNN-bucket-transforms.sql` creating
      `bucket_transformation_policies`.
- [ ] **T06** Add policy CRUD endpoints + bucket-key rotate endpoint to
      `services/adapters/src/storage-access-policy.mjs`.
- [ ] **T07** Add plan dimensions and enforce via gateway `limit-req` plus per-request
      CPU/timeout in the libvips wrapper.
- [ ] **T08** Console `ConsoleStoragePage` bucket detail: Transformations tab.
- [ ] **T09** Contract tests: derivative cache hit on second request; signed-URL
      requirement when configured; format=auto honours Accept header; libvips timeout
      returns 504 with `code=transform_timed_out`; max dimensions enforced.
- [ ] **T10** Run `openspec validate --strict` and re-run baseline validators.
