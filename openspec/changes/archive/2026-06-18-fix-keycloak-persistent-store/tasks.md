# Tasks — fix-keycloak-persistent-store

## Reproduce (live probe, test-first)
- [x] Reproduce on kind: chart-default Keycloak runs `start` with NO `KC_DB`/PVC → in-memory
  H2. Create a realm, delete the KC pod → after restart the realm is GONE (404). Documented in
  `audit/live-campaign/REPORT-RERUN.md` §4 (FIND-KC-NO-PERSISTENCE; exit-137 OOM + realm loss).

## Implement (chart — shippable product AND kind runtime)
- [x] Back Keycloak with the bundled `in-falcone-postgresql` in a DEDICATED `keycloak` database
  (`charts/in-falcone/values.yaml`): set `KC_DB=postgres`, `KC_DB_USERNAME`/`KC_DB_PASSWORD` via
  `secretKeyRef` (bitnami keys, identical on every profile), and `JAVA_OPTS_KC_HEAP` to cap the heap.
- [x] Supply `KC_DB_URL` (host = release-scoped postgresql Service) via a new ConfigMap
  `charts/in-falcone/templates/keycloak-db.yaml` mounted through `keycloak.envFromConfigMaps`
  (the component-wrapper renders `keycloak.env` verbatim, so a host-bearing URL can't be templated inline).
- [x] Add a `keycloak-db-init` initContainer that idempotently `CREATE DATABASE keycloak OWNER <app-role>`
  and `ALTER SCHEMA public OWNER` (PG15+ requirement) BEFORE Keycloak starts — keeps KC self-sufficient
  under `helm install --wait` (a post-install hook Job would deadlock). HA-safe (replica race tolerated).
- [x] Raise KC memory limit 1Gi→2Gi (chart default) — the OOM root cause (unbounded in-heap H2 dataset)
  is removed by DB-backing; the cap leaves native headroom.
- [x] Keep the DB-init image in lock-step with the postgresql image in the image-remapping overlays
  (`deploy/kind/values-kind.yaml` → bitnamilegacy; `charts/in-falcone/values/airgap.yaml` → private registry).

## Verify
- [x] `helm lint` clean; `helm template` renders correctly for default (`in-falcone-postgresql`), kind
  (`falcone-postgresql`), and `ha` (replicas 2, 0 KC PVCs, 2Gi) with NO per-profile env overrides.
- [x] Live on kind: KC starts in production mode Postgres-backed (87 KC tables in the `keycloak` DB),
  create realm `persist-test`+user → **delete the KC pod** → after restart the realm + user SURVIVE
  (admin API 200, public OIDC discovery 200, rows present in Postgres). No re-bootstrap. No OOM.
- [x] Black-box suite green (`bash tests/blackbox/run.sh`) — 896 pass / 0 fail (2026-06-18).

## Archive
- [x] `openspec validate fix-keycloak-persistent-store --strict` (clean); archived after merge of impl #613 to origin/main.
