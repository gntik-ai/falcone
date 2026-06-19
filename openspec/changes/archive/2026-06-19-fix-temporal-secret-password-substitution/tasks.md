# Tasks — fix-temporal-secret-password-substitution

## Reproduce (test-first)
- [x] Added a failing black-box test
  (`tests/blackbox/temporal-secret-password-substitution.test.mjs`, bbx-623-01..05) that renders the
  chart with `temporal.persistence.existingSecret` set and asserts: the ConfigMap renders the
  `__TEMPORAL_DB_PASSWORD__` placeholder (no plaintext, no literal `${POSTGRES_PWD}`); the start
  wrapper substitutes it from `POSTGRES_PWD`; `POSTGRES_PWD` comes from the existingSecret via
  `secretKeyRef`; and the default (no existingSecret) still renders the inline password with no
  placeholder — failing while the config rendered the literal unexpanded password.

## Implement
- [x] `charts/in-falcone/templates/temporal/config.yaml`: render `"__TEMPORAL_DB_PASSWORD__"` for both
  datastores' `password` when `persistence.existingSecret` is set; inline otherwise. Corrected the
  stale "SQL driver expands ${...}" comment.
- [x] `charts/in-falcone/templates/temporal/deployments.yaml`: extended the start-wrapper `sed` to
  substitute `__TEMPORAL_DB_PASSWORD__` from `POSTGRES_PWD` (sed-escaped), into the writable in-pod
  config copy only.

## Verify
- [x] New black-box test passes (5/5); `helm template` renders the placeholder (existingSecret) /
  inline password (default); `helm lint` exits 0; `bash tests/blackbox/run.sh` green.
- [x] Substitution verified robust for passwords containing `/ & \` (the value is injected literally).
- [ ] Acceptance: on a stack with a generated `POSTGRESQL_PASSWORD` + `existingSecret`, the Temporal
  server pods start (no `no usable database connection`) and the ConfigMap has no plaintext password
  (real-stack verification).

## Archive
- [ ] `openspec validate fix-temporal-secret-password-substitution --strict`; archive after merge.
