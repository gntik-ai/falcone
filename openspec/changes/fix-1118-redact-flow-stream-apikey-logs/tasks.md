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
