# Tasks — fix-bootstrap-job-standalone-apisix

## Investigation
- [x] The bootstrap Job runs `bootstrap.sh` from `templates/bootstrap-script-configmap.yaml`
  (image `bootstrap.job.image`). Its `run_upgrade_reconciliation` calls `ensure_apisix_route`,
  which PUTs to `$APISIX_ADMIN_URL/apisix/admin/routes/$id` and `exit 1`s on any non-2xx.
- [x] APISIX runs in standalone mode by DEFAULT (`apisix.config.inline.APISIX_STAND_ALONE: "true"`,
  `apisix.env`). The script did not read APISIX_STAND_ALONE at all. The one-shot auth phase
  (`run_one_shot_bootstrap`) is fail-closed and runs BEFORE the reconcile, so the realm/clients/
  superadmin are provisioned — but the reconcile then aborts the Job (it never writes the marker /
  reports success). Live: the admin Service `falcone-in-falcone-apisix-admin:9180` refuses
  connections under standalone, so the PUT could never succeed.

## Implementation
- [x] Gate `run_upgrade_reconciliation` at template time on the chart's APISIX standalone value
  (`dig "config" "inline" "APISIX_STAND_ALONE" "false" .Values.apisix` == "true"): in standalone
  mode the function is a no-op (logs the skip, emits ZERO admin-API calls); the route loop is
  preserved unchanged for non-standalone. Single source of truth — same value that configures
  APISIX standalone, so they cannot desync.
- [x] Added a fail-closed `verify_auth_layer` smoke step, invoked in `main()` between the reconcile
  phase and `write_marker`. Confirms the platform realm + each provisioned client (console,
  gateway, from `bootstrap.oneShot.keycloak.clients`) + superadmin exist in Keycloak before the
  Job reports success; `exit 1` otherwise. Reuses the script's proven admin-API query idioms and
  hits Keycloak directly (not via APISIX).

## Verification
- [x] Live kind cluster: confirmed the reconcile's target is dead in standalone — a route PUT to
  `falcone-in-falcone-apisix-admin:9180` from a throwaway pod → connection refused (http=000),
  i.e. the old `ensure_apisix_route` would `exit 1` and abort the Job (the D2 mechanism).
- [x] Rendered bootstrap.sh: standalone (default) → 0 `ensure_apisix_route` call-sites + skip log;
  non-standalone → 22 call-sites; `bash -n` valid in both; `verify_auth_layer` defined + invoked
  before `write_marker`. (Full live Job re-run / superadmin-login scenario needs Keycloak admin
  credentials — out of scope to harvest from the shared cluster; the superadmin-roles scenario
  also depends on A2 `fix-platform-client-default-scopes`.)
- [x] Black-box regression: `tests/blackbox/bootstrap-job-standalone-apisix.test.mjs` (4 cases,
  helm-template + `bash -n`, self-skips without helm). Full suite: 648/648 pass.

## Archive
- [ ] `/opsx:archive fix-bootstrap-job-standalone-apisix`
