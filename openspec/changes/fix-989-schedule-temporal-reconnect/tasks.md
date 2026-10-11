# Tasks

- [x] Verify clean assigned source worktree and issue/run branch at base 64453824fb6791b4c146e29fdd4406ab884cc986.
- [x] Reproduce connect-error classification failure twice at the public scheduleGateway seam before changing source.
- [x] Add the failing classification/retry test and implement sanitized connect errors.
- [x] Add a failing concurrent-connect/reuse test and move retryable memoization into the gateway.
- [x] Remove the boot-time rejected-promise cache while preserving the dynamic SDK import.
- [x] Verify failure-then-success on the same registry and directly injected client regressions.
- [x] Extend HTTP coverage for all five unavailable/recovered routes, redaction, 501 and 404 responses.
- [x] Run available bounded tests and syntax/whitespace checks; record environment limits.
- [ ] PR CI: run schedule-management, event-trigger-integration, flows-api and executor-5xx-code-redaction blackbox suites with existing dependencies installed and localhost sockets permitted.
- [ ] Operator: confirm 503 during an outage and 200 after connectivity recovery on the same pod; note replacement of old executors alongside falcone-charts#20.

## Diagnosis and red/green evidence

Candidates were a sticky rejected connect memo (predicts no subsequent dial), an
unclassified connect rejection (predicts no platform status/code), and an operation-phase
failure (predicts an already-connected schedule client). The injected factory rejects
before returning any client, excluding operation-phase failures from this reproduction.
The boot getter's scheduleClientP retained rejection with no reset, while the gateway
forwarded it unchanged. These are the confirmed lifecycle and classification causes.

Reproduction command:
`node --test --experimental-test-isolation=none tests/unit/flow-schedule-temporal-reconnect.test.mjs`

Before source changes, this command failed twice: the actual error message was
connect deadline exceeded with no statusCode/code, instead of Temporal is unavailable,
503 and TEMPORAL_UNAVAILABLE. After the first slice it passed. The next slice failed
on two concurrent connection attempts instead of one, then passed after moving the
memo into the gateway. The final command passes all three lifecycle tests. No debug
instrumentation or dependency changes were introduced.

## Local verification

- PASS: `node --test --experimental-test-isolation=none tests/unit/flow-schedule-temporal-reconnect.test.mjs tests/unit/flow-trigger-registry.test.mjs tests/unit/executor-public-error-code.test.mjs` (15 tests).
- PASS: `node --check` on both modified runtime files and both new/modified test files; `git diff --check`.
- SKIPPED: `node --test --experimental-test-isolation=none tests/blackbox/flows-schedule-management.test.mjs tests/blackbox/event-trigger-integration.test.mjs tests/blackbox/flows-api.test.mjs tests/blackbox/executor-5xx-code-redaction.test.mjs`. Schedule-management and flows-api cannot load the existing pg dependency; event-trigger-integration cannot load the existing yaml dependency (ERR_MODULE_NOT_FOUND). Executor redaction tests stop before requests because localhost listen is denied with EPERM. These are sandbox limitations, not assertion failures. No timeout wrapper was used.
- SKIPPED: live Temporal outage/recovery verification requires runtime access and is reserved for the operator.
