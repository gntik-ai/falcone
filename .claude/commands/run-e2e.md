---
description: Helm-install Falcone on the kind test cluster and run the FULL Playwright E2E suite; ALWAYS tears the workloads down afterwards. Use after the issues are resolved.
argument-hint: "[filter]   (optional grep over spec titles)"
allowed-tools: Read, Glob, Grep, Bash
---
Run the complete real-stack E2E on the kind test cluster: `bash tests/e2e/run.sh $ARGUMENTS`.

It Helm-installs Falcone into an ephemeral namespace via `tests/e2e/stack.sh up` (using `./kubeconfig-test-cluster-b.yaml` automatically), gates on ALL services healthy, runs the whole Playwright suite, and ALWAYS removes the workloads on exit (the namespace is deleted; the cluster is left intact) — teardown runs even on failure or Ctrl-C.

If the suite or the Helm wiring in `stack.sh` is missing, say so and point to `/build-e2e` — do not improvise.
Report pass/fail counts, failing `us-`/spec names with expected vs actual, artifact paths, and confirm the namespace was deleted. If there are failures, suggest `/report-e2e-failures` to turn them into OpenSpec issues. Do not fix anything here. Prefer delegating to `e2e-runner`.
