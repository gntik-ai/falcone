## 1. Failing tests (test-first)

- [x] 1.1 Unit tests for `buildInvokeHeaders(payload, caller)` — full caller → all five `X-Falcone-*` (roles comma-joined); no caller → only content headers; absent/empty fields omitted (`tests/blackbox/function-caller-context.test.mjs` bbx-639-hdr-01..03). Failed before the export existed.
- [x] 1.2 Unit tests for `callerContextFromHeaders(headers)` — headers→context mapping; missing → null fields + `roles=[]`; comma-split roles (bbx-639-ctx-01..02).
- [x] 1.3 In-process fn-runtime end-to-end (real HTTP server): POST `X-Falcone-*` headers + a spoofing body → `context` has the HEADER-derived values, `params` keeps the body untouched (bbx-639-rt-01); a `main(params)`-only function still succeeds (bbx-639-rt-02).

## 2. Implement — send side

- [x] 2.1 `fn-handlers.mjs::fnInvoke`: build `caller` from `ctx.identity` (tenant/principal/actorType/roles) and `r.workspace_id` (fallback `ctx.identity.workspaceId`); pass `{ timeoutMs, caller }` to `invokeKnative`.
- [x] 2.2 `function-executor.mjs`: export `buildInvokeHeaders(payload, caller)` (omits absent/empty fields); `invokeKnative` accepts `caller` and composes headers via it.

## 3. Implement — receive side

- [x] 3.1 `fn-runtime/server.mjs`: export `callerContextFromHeaders(headers)`; request handler calls `main(params, callerContextFromHeaders(req.headers))`; `resolveMain` reads `FN_SRC` at call time.
- [x] 3.2 Export `server`; guard `listen` with a `pathToFileURL` entrypoint check so importing the module (tests) does not bind a port.

## 4. Verify

- [x] 4.1 New tests pass (7/7).
- [x] 4.2 `bash tests/blackbox/run.sh` — 1004 pass / 0 fail; existing fn tests (18) unchanged; `openspec validate --strict` clean.
- [ ] 4.3 Live kind probe: rebuild control-plane + fn-runtime images, deploy a function returning its `context` arg, invoke as a real principal; assert `tenantId`/`workspaceId`/`principal` match the verified caller and a body field does not override the context.

## 5. Archive

- [ ] 5.1 `/opsx:archive add-function-caller-context` after merge.
