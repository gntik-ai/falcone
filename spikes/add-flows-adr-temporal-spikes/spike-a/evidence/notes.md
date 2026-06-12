# EPHEMERAL SPIKE — not production code

## Spike A — evidence notes

All runs target the local PostgreSQL-backed Temporal dev stack
(`spikes/add-flows-adr-temporal-spikes/docker-compose.yml`, project `flows-spike`,
frontend `127.0.0.1:7233`), SDK `@temporalio/*@1.18.1`, Node v26.

### Artifacts in this directory

| File | What it proves |
|---|---|
| `sandbox-check.json` | cel-js AND jsonata both survive the Temporal V8 workflow sandbox and evaluate `amount > 100` deterministically (Task 2.4 / 2.5). |
| `workflow-bundle.js` | The compiled workflow bundle (both engines bundled) — proof both engines are bundlable for the isolate. |
| `kill-resume-history.json` | Full decoded workflow history of a run where the worker was SIGKILLed mid-execution and restarted (17 events; 3 workflow-task-started ⇒ replay happened). |
| `kill-resume-assertions.json` | Machine-checked assertions: completed, correct branch, retry attempts = 3, definition present in start input, resumed across worker tasks. |
| `replay-result.json` | SDK replayer (`Worker.runReplayHistory`) replayed the live proto history with NO non-determinism error. |

### Scenario coverage (spec `specs/workflows/spec.md`)

| Scenario | Result | Evidence |
|---|---|---|
| Worker killed mid-run resumes to completion | PASS | `kill-resume-assertions.json` → `completed:true`, `resumedAcrossWorkerTasks:true` |
| Branch evaluation is deterministic on replay | PASS | trace shows `branch:amount > 100=>true` once; `replay-result.json` deterministic:true |
| Retry policy honoured across worker restarts | PASS | `retryAttempts:3`, `retryHonoured:true`; activity counter file reached attempt 3 only after the restart |
| Definition-passing strategy is validated | PASS | `definitionInHistoryInput:true` — the full parsed 5-node definition is decoded out of the WorkflowExecutionStarted input payload |
| Expression engine comparison documented | PASS | `../expression-engines.md` |
| A single expression engine selected | PASS (CEL) | `../expression-engines.md` decision section |

### Definition-passing decision (D3 — input vs activity-load)

**Decision: pass the parsed flow definition as WORKFLOW INPUT** (not loaded via an activity).

Evidence and reasoning:

- The kill-resume run's `WorkflowExecutionStarted` event carries the entire parsed 5-node
  definition in its input payload (`definitionInHistoryInput:true`). Because input is recorded
  in history at schedule time, replay is deterministic without any external lookup — proven by
  the clean `Worker.runReplayHistory` pass.
- The YAML is parsed OUTSIDE the workflow (the `yaml` lib, in `run-kill-resume.mjs`); the
  workflow receives an already-parsed object, so no parser runs inside the isolate on the hot
  path and the parser is not a sandbox/determinism concern.
- History-size note: the definition is small (3 canonical nodes; 5 in the durability variant),
  so embedding it in history input is cheap. The alternative — loading by `flowId`+`version`
  via an activity — is also history-safe (activity results are recorded) but adds a read
  round-trip on every replay and a dependency on the definition store being reachable at replay
  time. For the spike scale, input-passing is strictly simpler and equally deterministic. The
  production interpreter change can switch to activity-load if definitions grow large enough
  that history size becomes a concern; both are recorded as validated.

### Worker-kill mechanics

`run-kill-resume.mjs` spawns `worker-entry.mjs` as a child process, starts the interpreter
workflow (which enters a 9s `slow` activity), then `process.kill(pid, 'SIGKILL')` while the
activity is in flight, and spawns a fresh worker. Temporal re-delivers the workflow task to the
new worker, which replays history and resumes. The `flakyCharge` activity uses an on-disk
attempt counter so the retry count is observable across the restart (reaches 3).
