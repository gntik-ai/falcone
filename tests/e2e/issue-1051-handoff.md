# Issue 1051 source handoff

The chart pin remains `94d5c43cd95e506b7f9955547f5d0be64d8cd69d`.
At that revision, `templates/temporal/schema-job.yaml` and
`templates/temporal/db-bootstrap-job.yaml` render ordinary Jobs on fresh installs.
Both reference `in-falcone-temporal`; the Temporal ExternalSecret is a
post-install hook. The old phased harness waited for schema completion before
restoring the skipped OpenBao/ESO hooks and masked schema/bootstrap wait failures.
Re-applying an existing Job could not reset its deadline.

The chart's platform credential hook can seed `in-falcone-temporal` before Helm
installation, so a missing Secret alone is not a confirmed explanation of run
37297020711. Historical logs and a live diagnostic run remain necessary to identify
that run's final failing step. No readiness timeout was increased.

The source fix defers both DB Jobs during Helm installation, deletes stale Jobs,
requires Temporal ExternalSecret readiness and target existence, and then runs
DB bootstrap, schema migration and namespace bootstrap with mandatory completion
waits. Helm 3 uses the executable post-renderer; Helm 4 uses the same renderer as
a local plugin installed into a temporary data directory.

`tests/blackbox/e2e-failure-diagnostics.test.mjs` injects failed/incomplete Jobs,
missing credentials, rollout, health and smoke failures. Its status fixture
identifies `temporal-stuck` with `CreateContainerConfigError` and the missing
`in-falcone-temporal` reference, plus init-container `ImagePullBackOff` and previous
termination evidence. These are simulated diagnostics, not cluster log evidence.
Seeded and randomly generated credential values must be absent from output.
The collector limits output per pod, per namespace and overall; it never fetches
Secret data or Pod specs and excludes credential-handling container logs.

Before publication, run the two E2E blackbox suites and Bash syntax checks.
ShellCheck is absent in the source sandbox. After publication, CI/release gates
must run ShellCheck and fresh-kind integration, attach the diagnostic logs and
measured provisioning times to the PR, and verify both Temporal Jobs Complete.
Retain the Mongo bearer round trip and the uploaded plan-enforcement TAP with
pass greater than zero. Run workflow_dispatch on the branch, then on main after
the authorized merge. Network/container runs cannot be performed in this sandbox.
