## Context

The `add-seaweedfs-deployment` change (archived `2026-06-14-add-seaweedfs-deployment`) introduced SeaweedFS as a sub-chart in `charts/in-falcone/` with three values-level defects that were not apparent from `helm template` alone but surfaced immediately on the kind `test-cluster-b` cluster during the first real MinIO→SeaweedFS cutover attempt. All three defects are values-only; no Helm templates, application code, or migrations are involved. The fixes are already committed on branch `fix/seaweedfs-deployment-defects` at commit d33f169.

## Goals / Non-Goals

**Goals:**
- Record the three deployment-correctness invariants as enforceable OpenSpec requirements so they cannot regress.
- Provide clear WHEN/THEN scenarios that double as test oracles for future chart-validation runs.
- Reference exact code evidence (`charts/in-falcone/values.yaml` line numbers) for traceability.

**Non-Goals:**
- No application-code, API-contract, or migration changes.
- No change to the HA profile values (`values/profiles/ha.yaml`) — its `011` replication with 3 volume servers is correct.
- No Helm template authoring (templates already render correctly; only the values were wrong).

## Decisions

**Decision 1 — Use `bitnamilegacy/postgresql:17.2.0` for the filer init-container.**
The original `bitnami/postgresql:16` tag was removed from Docker Hub as part of the bitnami→bitnamilegacy migration. The replacement `docker.io/bitnamilegacy/postgresql:17.2.0` (non-root UID 1001) is already used elsewhere in the umbrella chart's postgresql component, making it the obvious drop-in: `pg_isready` and `psql` are present, `runAsNonRoot: true` is satisfied, and no new registry dependency is introduced. Alternative (building a custom init-container image or using alpine+psql) rejected as unnecessary complexity.

**Decision 2 — Set dev/base replication to `"000"` (not `"001"`).**
SeaweedFS replication notation `<cross-DC><cross-rack><same-rack>`: `001` means one extra same-rack replica, requiring a second volume server. The dev/base profile runs `volume.replicas: 1`. Writing with `001` makes the master unable to place a replica and returns `500 InternalError` on every PUT. Correcting to `000` (single copy, no replication) makes the single-volume-server dev topology fully functional. The three values corrected are `seaweedfs.global.seaweedfs.replicationPlacement`, `seaweedfs.master.defaultReplication`, and `seaweedfs.filer.defaultReplicaPlacement` — all must agree or the master and filer negotiate conflicting placement goals.

**Decision 3 — Use kebab-case component IDs in `allowedAppComponents`.**
The chart's component-wrapper Helm helper sets `app.kubernetes.io/name` to the kebab-case componentId (e.g. `control-plane`, not `controlPlane`). The NetworkPolicy ingress selector matches on this label. Supplying camelCase values produces a selector that never matches any pod, silently dropping all app→SeaweedFS:8333 connections. The fix is to align the three entries with the rendered label values: `control-plane`, `control-plane-executor`, `workflow-worker`. No template change is needed.

## Risks / Trade-offs

- [Risk: `bitnamilegacy` image availability] The `bitnamilegacy` Docker Hub organisation is a Bitnami-controlled transition vehicle; images there may eventually be removed or stop receiving security patches. → Mitigation: the umbrella chart already depends on `bitnamilegacy/postgresql` for the main postgresql component; this init-container reuses the same image reference, so any future upgrade of that reference covers both.
- [Risk: replication `000` provides no redundancy] Single-copy storage is appropriate only for dev/kind. The HA profile's `011` is correct. → Mitigation: the requirement explicitly scopes `000` to the single-volume-server profile; the spec scenario is written in terms of the replica count, not a hardcoded environment name.
- [Risk: NetworkPolicy label coupling] If a future refactor renames a componentId, the `allowedAppComponents` list would silently drift again. → Mitigation: the new spec requirement makes this coupling explicit and testable.

## Migration Plan

No migration is required. The values fixes take effect on the next `helm upgrade` (or fresh `helm install`) with `seaweedfs.enabled: true`. Rollback = revert commit d33f169 or set `seaweedfs.enabled: false` to fall back to MinIO.
