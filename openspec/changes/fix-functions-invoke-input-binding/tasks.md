# Tasks — fix-functions-invoke-input-binding

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: invoke with `{n:21}` → `{doubled:0}`; with `{parameters:{n:21}}` → `{doubled:42}`.

## Implement (kind runtime AND shippable product)
- [ ] Accept top-level input (or document the envelope and validate) — kind `fn-handlers.mjs` + product functions invoke.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: The documented shape returns the correct result; an unexpected shape 4xx, not a silent wrong answer.

## Archive
- [ ] `openspec validate fix-functions-invoke-input-binding --strict`; `/opsx:archive fix-functions-invoke-input-binding` after merge.
