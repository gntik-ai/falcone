# Tasks — fix-storage-object-binary-put

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: PUT a binary body → 400 INVALID_JSON; only JSON `{content}` works.

## Implement (kind runtime AND shippable product)
- [ ] Accept raw bytes (or base64) so arbitrary objects can be stored — kind `storage-handlers.mjs` + product storage handler.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Binary round-trip is byte-identical.

## Archive
- [ ] `openspec validate fix-storage-object-binary-put --strict`; `/opsx:archive fix-storage-object-binary-put` after merge.
