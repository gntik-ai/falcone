# Tasks — fix-functions-ksvc-tenant-namespacing

## Reproduce (test-first)
- [x] Add a failing black-box test for the ksvc naming contract: `tests/blackbox/functions-ksvc-tenant-namespacing.test.mjs` (two tenants' same-named workspaces + same action must NOT collide on one ksvc).

## Implement (kind runtime AND shippable product)
- [x] Add `ksvcNameForWorkspace(workspace, actionName)` in `deploy/kind/control-plane/function-executor.mjs` — appends a short stable hash of `tenantId:workspaceId` (both globally unique) to the DNS-1035 name. Rewire the deploy call site in `fn-handlers.mjs` to use it.
- [x] The shippable product runtime (`apps/control-plane/src/runtime/functions-executor.mjs`) is backend-pluggable and delegates the Knative backend to the same kind `function-executor.mjs`, so the fix covers both.

## Verify
- [x] Black-box suite green (718 pass); new test `functions-ksvc-tenant-namespacing` 5/5; existing `knative-function-tenant-scope` 9/9 still green.
- [x] Acceptance: two same-named workspaces across tenants get distinct, DNS-1035-valid ksvcs; the name is deterministic so invoke resolves the caller-scoped ksvc.

## Archive
- [ ] `openspec validate fix-functions-ksvc-tenant-namespacing --strict` (passing); `/opsx:archive fix-functions-ksvc-tenant-namespacing` after merge.
