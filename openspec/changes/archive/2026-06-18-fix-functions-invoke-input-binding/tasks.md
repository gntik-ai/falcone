# Tasks — fix-functions-invoke-input-binding

## Reproduce (test-first)
- [x] Failing black-box probe: `tests/blackbox/functions-invoke-input-binding.test.mjs`. The two invoke surfaces bound input inconsistently — kind `fnInvoke` read `body.parameters ?? {}` (dropped top-level input → `{doubled:0}`); the executor passed the whole body to the backend (so the documented `{parameters:{n:21}}` reached the function un-unwrapped).

## Implement (kind runtime AND shippable product)
- [x] Added a shared `invocationInput(body)` binding: unwrap the documented `parameters` envelope when present, else honor a bare top-level input map (never silently drop it); envelope-only keys (`responseMode`/`triggerContext`/`idempotencyScope`/`versionId`/`execution`) are excluded.
- [x] kind `deploy/kind/control-plane/fn-handlers.mjs` — `fnInvoke` now uses `invocationInput(ctx.body)`.
- [x] product `apps/control-plane/src/runtime/functions-executor.mjs` — the invoke branch now passes `invocationInput(params.payload)` to the backend (the documented envelope reaches the function correctly; top-level input still works).

## Verify
- [x] Black-box suite green: bbx-fn-invoke-01 (documented `{parameters}` unwrapped), -02 (top-level honored), -03 (empty body), -04 (kind binding parity). knative-function-tenant-scope + executor-credential-workspace-binding regression unchanged.
- [x] Acceptance: the documented shape returns the correct result; top-level input is honored rather than silently dropped to the wrong answer.

## Archive
- [x] `openspec validate fix-functions-invoke-input-binding --strict`; archived with the P2 batch.
