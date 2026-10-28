# fix-1309: Increase the web-console source-build memory budget

## Problem and scope

The `/next/` Vite build aborted at its 1536 MiB V8 heap cap in the legacy console
image CI build on main. Both Vite RUN instructions in
`apps/web-console/Dockerfile` use that cap. Raise both to 3072 MiB and preserve
exactly three builder RUN layers: locked dependency installation, legacy build,
and next build. No other Dockerfile instructions or runtime resources change.

The companion falcone-charts change raises only the web-console BuildConfig
memory limit from 3Gi to 4Gi, retaining its 512Mi request. The other five builds
retain 128Mi requests and 1Gi limits. The 3072 MiB heap leaves 1024 MiB of the
4Gi container limit for non-heap memory and the builder; this is a configured
budget, not measured build headroom. No schema shape or value keys change.

## Regression evidence

The public seam is the tracked Dockerfile consumed by root-context image builds.
Before changing it, `node --test tests/blackbox/source-build-root-context.test.mjs`
went red with the new 3072 MiB expectations. Running the file directly with Node
exposed the exact mismatch: both RUN instructions still supplied 1536 MiB.

Existing tests with changed expectations in that file are:

- bbx-922-002: `web-console builds dist from the root pnpm lockfile and copies only the builder artifact into runtime`.
- bbx-922-003: `web-console final stage retains numeric non-root user, port, static server, and command` (through the shared builder validator).
- bbx-922-005: formerly `builder contract rejects 512/768 MiB heaps and a combined install/build RUN regression`; now it also rejects 1536 MiB and tests each build independently.

bbx-922-005 mutates each of the legacy and next RUN instructions separately to
512, 768, and 1536 MiB and requires a rejection mentioning 3072. It also retains
the combined install/build RUN rejection. bbx-922-004 retains its existing
pre-fix Dockerfile rejection expectations.

## Cross-repository delivery and risks

The deployment maker owns the default 4Gi limit, chart tests (including a
non-default override such as 5Gi), and Helm render isolation evidence. Hermes
owns the immutable `FALCONE_CHARTS_REF` update after the deployment change; the
source maker does not edit workflow pins. Publish the paired chart change first.

Projects with quotas or LimitRanges below 4Gi per build pod may reject the build.
Operators can override
`global.openshiftBuild.serviceResources.web-console.limits.memory`, keeping the
heap below the container limit. Bundle growth may eventually exhaust 3072 MiB.
Rollback reverts both changes and restores the prior chart pin, 1536 MiB heap,
and 3Gi limit, bringing back the original OOM risk.

## Validation and remaining gates

The Dockerfile contract is the bounded source regression check. PR CI must pass
the `web-console-next` job, including `Build the legacy console image without
publishing`. A local `/next/` production build succeeded using the installed Vite CLI directly
because pnpm's Node-version subprocess fails with `EPERM` in the sandbox. From
`apps/web-console-next`, the measured command was:

```sh
/usr/bin/time -v env NODE_OPTIONS=--max-old-space-size=3072 CSP_TEST_HARNESS= VITE_BASE_PATH=/next/ VITE_APP_VERSION=dev VITE_APP_COMMIT_SHA= node node_modules/vite/bin/vite.js build
```

It completed in 38.05 seconds with peak RSS **2,410,664 KiB (2354.2 MiB)**,
**717.8 MiB below 3072 MiB** and 1741.8 MiB below the paired 4Gi limit. RSS includes
non-heap memory; the difference is an RSS comparison, not a measured V8 heap
margin or a guarantee for the container build. Docker access is denied in the
maker sandbox, so PR CI must still validate the actual image build.

All five Dockerfile subtests pass, including the independent mutations. The
complete black-box command cannot pass here because its service-catalog subtest
encounters `spawnSync git EPERM`, including with a process-scoped safe-directory
setting. The implementation handoff marks that full check as skipped for this
environment; no safety gate is removed.
