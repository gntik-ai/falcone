# Tasks — fix-kind-executor-realtime-url

## Reproduce (test-first)
- [x] Added a failing black-box test
  (`tests/blackbox/kind-executor-realtime-url-wiring.test.mjs`, bbx-621-01..04) that parses
  `deploy/kind/executor-demo.yaml`, locates the `falcone-cp-executor` Deployment container, and
  asserts its env contains `REALTIME_DOCUMENTDB_URL` from `secretKeyRef`
  `in-falcone-documentdb-replication`/`realtime-url` with `optional: true`, AND that the demo
  manifest agrees with the `controlPlane.env` stanza in `values-campaign.yaml` — failing while
  the manifest omitted the env var.

## Implement
- [x] `deploy/kind/executor-demo.yaml`: added the `REALTIME_DOCUMENTDB_URL` env var (secretKeyRef,
  `optional: true`) to the `falcone-cp-executor` container, matching the campaign Helm values.

## Verify
- [x] New black-box test passes; `bash tests/blackbox/run.sh` green (no regressions).
- [ ] Acceptance: on the kind stack with the replication secret present, the executor env includes
  `REALTIME_DOCUMENTDB_URL` and `/v1/realtime/*/changes` opens an SSE stream (200), not
  `501 REALTIME_DISABLED` (real-stack verification).

## Archive
- [ ] `openspec validate fix-kind-executor-realtime-url --strict`; archive after merge.
