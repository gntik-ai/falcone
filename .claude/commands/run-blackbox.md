---
description: Run the full end-to-end black-box test suite and report results.
argument-hint: "[capability or test filter]   (optional)"
allowed-tools: Read, Glob, Grep, Bash
---
Run the black-box suite through the public interface. Optional filter: $ARGUMENTS.

1. Prepare the environment / build or start the app as its public entry point requires.
2. Run `bash tests/blackbox/run.sh` (pass the filter through if provided and supported).
3. On failure, report failing `bbx` IDs, the mapped scenario, and expected-vs-actual. Do not fix.

Prefer delegating to the `e2e-runner` subagent. Output pass/fail counts and exit status.
