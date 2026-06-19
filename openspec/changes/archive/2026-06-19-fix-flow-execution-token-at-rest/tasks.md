# Tasks — fix-flow-execution-token-at-rest

## Reproduce (test-first)
- [x] Added a failing black-box test
  `tests/blackbox/flows-execution-token-not-in-memo.test.mjs` (`bbx-flow-memo-01`) that
  boots the control-plane server with an injected fake Temporal client recording every
  `workflow.start()` call, publishes a flow, starts an execution, and asserts:
  - The `memo` field on the start options is `null`, `undefined`, or an empty object (no
    token key present).
  - The string `falconeExecutionToken` does not appear anywhere in the serialised memo.
  - `opts.args[0].tenant.executionToken` is a non-empty string (the token still travels via
    workflow args).
  - The plaintext token value does not appear in the memo.

## Implement
- [x] `apps/control-plane/src/runtime/flow-executor.mjs`:
  - Removed `memo: { [EXECUTION_TOKEN_MEMO_KEY]: executionToken }` from the
    `client.workflow.start` options in `startExecution`.
  - Removed `memo: { [EXECUTION_TOKEN_MEMO_KEY]: executionToken }` from the
    `client.workflow.start` options in `retryExecution`.
  - Replaced the misleading "encrypted by Temporal" comment at both sites with an accurate
    explanation: the token travels in the workflow args (tenant envelope) and must not be
    placed in the memo because the memo is `json/plain` with no PayloadCodec configured (#633).
- [x] `apps/control-plane/src/runtime/execution-token.mjs`:
  - Removed the `EXECUTION_TOKEN_MEMO_KEY` export (was only ever written, never read).

## Verify
- [x] The new black-box test passes (`bbx-flow-memo-01`, 1/1 green).
- [x] `bash tests/blackbox/run.sh` — full suite green (997/997), no regressions.

## Archive
- [ ] After merge, run `openspec validate fix-flow-execution-token-at-rest --strict` one
  final time and archive with `/opsx:archive fix-flow-execution-token-at-rest`.
