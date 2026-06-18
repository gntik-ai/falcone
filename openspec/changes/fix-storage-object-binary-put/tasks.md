# Tasks — fix-storage-object-binary-put

## Reproduce (test-first)
- [x] Failing black-box probe: `tests/blackbox/storage-object-binary-put.test.mjs`. The server JSON-parsed every body, so a raw/binary PUT was rejected with 400 INVALID_JSON; the handler only read `body.content` (a string) → no faithful binary storage.

## Implement (kind runtime AND shippable product)
- [x] kind server `deploy/kind/control-plane/server.mjs`: `readBody` now returns a Buffer (binary-safe); a non-JSON content-type is kept as raw bytes (`ctx.rawBody`/`ctx.contentType`/`ctx.rawBodyIsBinary`) instead of being rejected as INVALID_JSON. JSON (or unspecified) is parsed as before.
- [x] kind `deploy/kind/control-plane/storage-handlers.mjs`: added exported `resolveObjectBody(ctx)` — raw binary body OR JSON `{content, contentType, encoding}` (encoding:`base64` decodes to exact bytes); `storagePutObject` stores the exact bytes; `s3()` reads the response as bytes (arrayBuffer, text fallback) and `getObject` returns `bytes`; `storageGetObject` adds `contentBase64` so binary round-trips.
- [x] Kind-only: object I/O lives in the kind storage REST handlers; the product `services/adapters` storage modules are quota/audit ops (no object-PUT), so no product-side change.

## Verify
- [x] Black-box suite green: bbx-storage-bin-01..05 (raw bytes byte-for-byte, base64 envelope, legacy text, default content-type, byte-identical round-trip); storage-object-io-routes + storage-bucket-ownership-idor regression unchanged (17 tests).
- [x] Acceptance: binary round-trip is byte-identical.

## Archive
- [x] `openspec validate fix-storage-object-binary-put --strict`; archived with the P2 batch.
