# Tasks

- [x] Verify assigned source worktree, issue/run branch and base HEAD; preserve related inherited edits.
- [x] Reproduce the leak against an isolated copy of immutable source HEAD before further source edits.
- [x] Verify red-to-green at the public HTTP/SSE seam for central executor, flow/LLM pre-stream, proxy and control-plane error paths.
- [x] Restrict query-bearing request logger arguments without changing response/auth/SSE/metric behavior.
- [x] Capture all logger calls using a synthetic sentinel and avoid printing captured diagnostics.
- [x] Demonstrate that injected `logger.error(req.url)` fails the leak assertion; restore the isolated copy.
- [x] Add source CI coverage without changing Hermes-managed chart pins.
- [x] Run bounded available tests and record unavailable checks.
- [ ] Source PR CI: run all three Temporal-dependent stream cases and existing socket-based flow/error-code regressions with installed dependencies.
- [ ] Paired charts maker/checker: implement and test the access-log format across all five profiles and preserve metrics export and route-copy alignment.
- [x] Paired charts checker fixes present on read-only follow-up inspection: valid YAML quoting and comparison of the parsed format to a known-good APISIX 3.10 literal across all five profiles. Chart execution evidence remains the paired maker/checker's responsibility.
- [ ] Runtime verifier: sentinel SSE request plus APISIX/executor/control-plane log check in kind.
- [ ] Operator follow-up: confirm external ingress/LB logging and track the nginx error-log residual until u5.

## Evidence

Assignment: worktree `/srv/engineering/worktrees/falcone/ff74fffe-da48-5af7-b281-103e47a0d6e0`, branch `agent/falcone/1118/ff74fffe-da48-5af7-b281-103e47a0d6e0`, base `5c3f4d40b389b5b0c565a0dd10cf15c334e1f34c`. All inherited modifications were within this issue's source scope.

- Expected RED: `node --test --experimental-test-isolation=none --test-name-pattern='forced 5xx on flow query-key authentication' /tmp/falcone-1118-repro-yzcshr_2/tests/blackbox/flow-stream-apikey-logs.test.mjs` against the assigned HEAD archive. The boolean leak assertion reported `true !== false`; no captured content was printed. Additional proxy, flow/LLM and control-plane scenarios each failed assertions on pristine source and passed on corrected source.
- PASS: new log-capture suite, eight cases; three Temporal-dependent cases SKIPPED because existing yaml/ajv packages are absent. Command: `node --test --experimental-test-isolation=none tests/blackbox/flow-stream-apikey-logs.test.mjs`.
- PASS: eight existing metric-route-label cases. Command: `node --test --experimental-test-isolation=none tests/unit/http-metric-route-labels.test.mjs`.
- PASS: twelve authorization-denial audit cases after updating the shared HTTP harness binding. Command: `node --test --experimental-test-isolation=none tests/blackbox/authorization-denial-audit.test.mjs`.
- PASS: injected raw-URL logging fails specifically at the boolean leak assertion; syntax checks pass for both servers, the shared helper and test harnesses; `git diff --check` passes. No debug injection remains.
- SKIPPED: `node --test --experimental-test-isolation=none tests/blackbox/flows-execution-events.test.mjs`; module loading stops because existing `pg` is absent. Existing yaml/ajv dependencies and listening sockets are also required in CI.
- SKIPPED: `node --test --experimental-test-isolation=none tests/blackbox/executor-5xx-code-redaction.test.mjs`; all 25 cases stop at `listen EPERM: operation not permitted 127.0.0.1`, before requests reach the code under test.
- SKIPPED: runtime pod-log verification and paired chart checks are outside this source-only, offline sandbox.

No test timeout wrapper, dependency manifest change, lockfile change, credential access or deployment is needed. The temporary reproduction and mutation copies are removed after verification.

## Source follow-up after independent review (2026-10-11)

The assigned source branch was clean at the supplied HEAD `8536b67c655b06f903d6df32c544316ad2571af6`. The existing application implementation satisfies the reviewed source behavior; it is preserved without further runtime changes. This follow-up clarifies the paired chart serialization contract and records new verification evidence.

The two blocking checker findings belong to the separate deployment repository. Read-only inspection confirms `charts/in-falcone/templates/apisix-config-file.yaml:48` still uses a folded scalar with literal outer quotes and escaped delimiters, and `tests/blackbox/staging-infrastructure/apisix-access-log-contract.test.mjs:30` checks variables without asserting the parsed format's exact field layout. The deployment maker must correct both together, watch the strengthened contract fail before the template fix, and rerun its deterministic adapter/metrics-export checks. That worktree is outside this source assignment's writable roots. Hermes owns any subsequent chart-pin update.

- Reproduction/negative-control command: `node --test --experimental-test-isolation=none --test-name-pattern='forced 5xx on flow query-key authentication' tests/blackbox/flow-stream-apikey-logs.test.mjs`, run in an isolated archive. Replacing only the executor server with the immutable base version produces the expected boolean leak assertion failure. Restoring HEAD passes; injecting `logger.error(req.url)` fails that same assertion; restoring HEAD passes again. The confirmed cause is passing an exception containing the raw query-bearing URL directly to the logger. No captured query material was printed, and the archive was removed.
- PASS: log-capture suite, 8 cases; metric-route-label suite, 8 cases; authorization-denial audit suite, 12 cases. Each suite ran in its own process, avoiding shared metric registry interference.
- SKIPPED: 3 Temporal-dependent log-capture cases because existing yaml/ajv packages are not installed; flow-events suite because `pg` is not installed; all 25 executor-5xx cases because socket setup raises `listen EPERM: operation not permitted 127.0.0.1` before exercising assertions. Source PR CI must run these checks with installed dependencies and permitted sockets.
- SKIPPED: paired chart checks and runtime pod-log verification are outside the assigned source-only sandbox. Nginx error-log request lines and external ingress/LB logging remain the documented residuals.

No dependency changes, deployment edits, chart-pin edits or debug instrumentation are included in this follow-up.

## Source revalidation at the final Hermes pin (2026-10-11)

The assigned worktree and issue/run branch were clean at the supplied HEAD `3e043a61395dcdd0b2d7ff3506ccb63a4be6cacc`. Review found no remaining source implementation defect in the scoped logger paths. The previous implementation and Hermes-managed pins are preserved; this follow-up corrects the handoff's now-stale chart findings.

Read-only inspection of the paired deployment worktree now shows valid double-quoted YAML at `charts/in-falcone/templates/apisix-config-file.yaml:48`, instead of a folded scalar with literal quoting. Its access-log contract compares the parsed format against an independent APISIX 3.10 field-layout literal for default, staging, prod, airgap and kind. The earlier checker findings above describe the prior chart state; they are no longer pending implementation. This inspection does not claim chart render or runtime validation.

- PASS: `node --test --experimental-test-isolation=none tests/blackbox/flow-stream-apikey-logs.test.mjs`: 8 passing cases, 3 skipped Temporal-dependent cases because existing yaml/ajv packages are absent.
- PASS: `node --test --experimental-test-isolation=none tests/unit/http-metric-route-labels.test.mjs`: 8 passing cases.
- PASS: `node --test --experimental-test-isolation=none tests/blackbox/authorization-denial-audit.test.mjs`: 12 passing cases.
- PASS: isolated-archive reproduction and negative control using `node --test --experimental-test-isolation=none --test-name-pattern='forced 5xx on flow query-key authentication' tests/blackbox/flow-stream-apikey-logs.test.mjs`. Substituting the immutable base executor produces the expected boolean query-leak assertion failure; assigned HEAD passes. A deliberate raw-URL logger injection fails the same assertion; restored HEAD passes. Passing the exception containing the query-bearing URL directly to the logger is the confirmed original cause. Captured logs were suppressed, the temporary archive was removed, and assigned source was untouched.
- SKIPPED: `node --test --experimental-test-isolation=none tests/blackbox/flows-execution-events.test.mjs`: module loading stops at `ERR_MODULE_NOT_FOUND` for existing `pg`, before exercising assertions.
- SKIPPED: `node --test --experimental-test-isolation=none tests/blackbox/executor-5xx-code-redaction.test.mjs`: all 25 cases stop at `listen EPERM: operation not permitted 127.0.0.1`, before requests reach the code under test.
- SKIPPED: chart render/lint checks belong to the paired deployment assignment; pod-log verification requires the runtime verifier. Source PR CI must execute the missing stream and regression checks with installed dependencies and permitted sockets. Nginx error-log request lines and external ingress/LB logging remain the documented residuals.

No source runtime, dependency manifest, lockfile, deployment or chart-pin change is required by this review. No timeout wrapper or debug instrumentation remains.

## Source CI cancellation fix (2026-10-11)

The assigned branch was clean at the supplied HEAD `95e28073a99b3ee00b3174c3891ed96ab8a86285`. The quality-job cancellations originate in the log-capture transport: the successful flow response uses `Connection: keep-alive`, so ending the response does not finish the underlying socket. Waiting solely for socket `finish` leaves the test promise unresolved and cancels subsequent cases. The transport now closes the test client on the terminal `stream-end` frame, as it already does for a forced stream-error frame. Application behavior and all existing leak/status/frame assertions remain intact.

The regression seam is a real HTTP server and its serialized keep-alive SSE response, using the same synthetic request and in-memory network transport as the application cases. It requires no Temporal/database packages. Before the change, `node --test --experimental-test-isolation=none --test-name-pattern='terminal SSE completes' tests/blackbox/flow-stream-apikey-logs.test.mjs` reproduced the exact CI diagnostic: `Promise resolution is still pending but the event loop has already resolved`. After the transport fix, the regression passes.

- PASS: `node --test --experimental-test-isolation=none tests/blackbox/flow-stream-apikey-logs.test.mjs`: 9 passing cases, zero failures/cancellations; 3 Temporal-dependent cases remain SKIPPED because existing yaml/ajv packages are absent.
- PASS: `node --test --experimental-test-isolation=none tests/unit/http-metric-route-labels.test.mjs`: 8 cases.
- PASS: `node --test --experimental-test-isolation=none tests/blackbox/authorization-denial-audit.test.mjs`: 12 cases.
- PASS: isolated-archive negative control using `node --test --experimental-test-isolation=none --test-name-pattern='forced 5xx on flow query-key authentication' tests/blackbox/flow-stream-apikey-logs.test.mjs`: pristine source passes, injected `logger.error(req.url)` fails the boolean leak assertion, restored source passes. Captured logger content was suppressed and the archive removed.
- SKIPPED: the matching quality command `node --test tests/blackbox/flow-stream-apikey-logs.test.mjs tests/blackbox/flows-execution-events.test.mjs tests/blackbox/executor-5xx-code-redaction.test.mjs` cannot complete its checks here: flow-events imports missing `pg`; executor-5xx socket setup raises `listen EPERM: operation not permitted 127.0.0.1` before assertions. Source PR CI must run these and all three Temporal cases with installed dependencies and permitted sockets.
- SKIPPED: matching `pnpm test:unit` cannot complete here because node_modules is absent and sockets/subprocesses are restricted. Its before/after file-level results are identical (116 passing files, 109 environment-blocked files). Direct case diagnostics confirm missing packages and EPERM; this does not claim a passing full unit suite.
- SKIPPED: `pnpm lint` stops before repository validation with `sh: 1: npm: not found`; markdown lint also requires the installed toolchain.
- SKIPPED: paired chart render/lint checks belong to the deployment assignment; pod-log verification requires the runtime verifier. Nginx error-log request lines and external ingress/LB logging remain documented residuals.

This follow-up changes only the regression transport and this handoff. Existing dependency manifests, lockfiles, runtime source, safety gates, CI coverage and Hermes chart pins are preserved. No timeout wrapper or debug instrumentation remains.
