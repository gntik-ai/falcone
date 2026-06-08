---
description: REAL end-to-end verification of ONE issue on a LOCAL test cluster (kind/k3d/minikube/OpenShift Local). Deploys to an ephemeral namespace; ALWAYS tears the workloads down after.
argument-hint: "<change-id>"
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---
Verify change $1 against Falcone deployed to your LOCAL Kubernetes/OpenShift test cluster.

1. Read the change (`openspec show $1`) and its acceptance scenarios; use the linked use case(s) from `audit/use-cases.md` if present.
2. Ensure the deploy step in `tests/e2e/stack.sh` is wired to Falcone (Helm/Kustomize/manifests). If it is still the placeholder, specialize it first — delegate to `e2e-test-author`.
3. Write or update `tests/e2e/specs/issues/$1.spec.ts` (Playwright) exercising each scenario through the real UI and/or API. If the change touches tenant-scoped data, add a cross-tenant probe (tenant A must not reach tenant B's data).
4. Run it WITH guaranteed teardown: `bash tests/e2e/run-issue.sh $1`. This deploys into an ephemeral namespace, runs the spec, and ALWAYS deletes the namespace afterwards (all pods removed; the cluster stays) — even on failure.
5. Report pass/fail per scenario (expected vs actual; trace/screenshot paths on failure) and confirm the namespace was deleted.

Keep the spec committed as a regression test. Prefer delegating spec-writing to `e2e-test-author` and the run/report to `e2e-runner`. Never leave pods running.
