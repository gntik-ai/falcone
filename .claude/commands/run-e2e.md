---
description: Boot the REAL stack (backend + frontend) and run the FULL Playwright E2E suite. Use after the issues are resolved.
argument-hint: "[filter]   (optional grep over spec titles)"
allowed-tools: Read, Glob, Grep, Bash
---
Run the complete real-stack E2E: `bash tests/e2e/run.sh $ARGUMENTS` (boots the stack via `tests/e2e/stack.sh up`, runs the whole Playwright suite, tears down on exit).

If the suite or `stack.sh` is missing or still a placeholder, say so and point to `/build-e2e` — do not improvise.
Report pass/fail counts, failing `uc-`/spec names with expected vs actual, and artifact paths (traces, screenshots, HTML report). Do not fix anything here.

Prefer delegating to the `e2e-runner` subagent.
