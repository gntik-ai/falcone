# Issue 1051 source handoff

The Hermes-managed chart pin is `0ebbfef040bd68ef2cd1229d547d4fedf7498f87`.
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

The follow-up also defers the ordinary namespace bootstrap Job until frontend
readiness. At the pinned revision its name is
`falcone-temporal-r1-temporal-bootstrap`, so the harness now waits for the
resource identity returned by apply rather than `falcone-temporal-bootstrap`.
This avoids spending its active deadline waiting for DB prerequisites.

The supplied failing PR log reports `FailedScheduling` at
`2026-10-05T16:35:43Z` with `1 Insufficient cpu` for Temporal web/worker,
web-console and workflow-worker pods, then a DB-bootstrap wait timeout. The
diagnostic pod read was unavailable, so these events establish scheduling
pressure but do not establish the DB-bootstrap container's final reason.
Rendering the pinned chart confirms steady workload requests of 4250 mCPU and
8320 MiB, before Kubernetes system pods and startup Jobs. The new CI-only
`values-integration.yaml` overlay lowers those requests to 1325 mCPU and
4480 MiB. A before/after render comparison verifies identical workload inventory,
replicas, limits and all other workload spec fields. Production/shared kind
values, safety gates and all integration suites remain unchanged.

Diagnostics now explicitly serialize projected names/status as JSON and fetch
all three namespaces' pod/event summaries before logs. Status/event reads allow
5s API requests plus 3s client startup/discovery, within a 60s collector limit.
A 3.2s delayed-client regression verifies pod evidence survives; the old 3s
process deadline could not. PodScheduled conditions expose scheduling failures
even before any container status exists. No workload readiness timeout increased.

`tests/blackbox/e2e-failure-diagnostics.test.mjs` injects failed/incomplete Jobs,
missing credentials, rollout, health and smoke failures. Its status fixture
identifies `temporal-stuck` with `CreateContainerConfigError` and the missing
`in-falcone-temporal` reference, plus init-container `ImagePullBackOff` and previous
termination evidence. These are simulated diagnostics, not cluster log evidence.
Seeded and randomly generated credential values must be absent from output.
The collector limits output per pod, per namespace and overall; it never fetches
Secret data or Pod specs and excludes credential-handling container logs.

Both E2E blackbox suites and Bash/Node syntax checks passed in this follow-up.
The actual pinned-chart render comparison and Temporal post-renderer check passed
with Helm 4.2.3; stubbed lifecycle tests exercise Helm 3 and Helm 4.
ShellCheck is absent in the source sandbox. After publication, CI/release gates
must run ShellCheck and fresh-kind integration, attach the diagnostic logs and
measured provisioning times to the PR, and verify both Temporal Jobs Complete.
Retain the Mongo bearer round trip and the uploaded plan-enforcement TAP with
pass greater than zero. Run workflow_dispatch on the branch, then on main after
the authorized merge. Network/container runs cannot be performed in this sandbox.

The separate real-stack failure is a host bind collision on port 55432. This
ChangeSet changes only the Hermes chart pin in `ci.yml`; its real-stack job,
compose ports/project and executor/audit runners match the unchanged base.
Leave that unrelated collision for runner diagnosis; rerun both real-stack
commands in CI without changing or weakening their tests.
