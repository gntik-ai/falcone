## 1. Failing tests

- [ ] 1.1 [test] Add a `helm template helm/charts/backup-status` smoke
      asserting the rendered manifest list contains zero resources whose
      `apiVersion` is `openwhisk.apache.org/v1`; today the test fails on 9
      such resources.
- [ ] 1.2 [test] Add a smoke asserting the rendered manifest list contains
      a `kind: ConfigMap` whose data carries the action source for
      `backup-status-collector`.
- [ ] 1.3 [test] Add a smoke asserting `values.yaml` ships
      `adapters.mongodb.enabled = true`, `adapters.s3.enabled = true`,
      `adapters.keycloak.enabled = true`, `adapters.kafka.enabled = true`,
      and `adapters.postgresql.enabled = true`.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite `helm/charts/backup-status/templates/openwhisk-actions.yaml`,
      `openwhisk-operations-actions.yaml`, and `openwhisk-audit-actions.yaml`
      as ConfigMaps whose `data` carries the action source and runtime
      spec; remove `apiVersion: openwhisk.apache.org/v1`.
- [ ] 2.2 [fix] Rewrite `openwhisk-trigger.yaml`, `openwhisk-rule.yaml`,
      `openwhisk-alarm.yaml` as ConfigMaps carrying the trigger / rule /
      alarm payloads to be applied by `wsk` post-install.
- [ ] 2.3 [fix] In `helm/charts/backup-status/values.yaml:10-17` set
      `adapters.{mongodb,s3,keycloak,kafka}.enabled = true`; document the
      backing services each adapter requires.
- [ ] 2.4 [impl] Add a Helm `pre-install` hook to the chart using `lookup`
      to verify the OpenWhisk component is reachable; fail with a clear
      error message when not.

## 3. Validation

- [ ] 3.1 [docs] Document the rewritten chart, the ConfigMap-then-wsk
      flow, and the dependency on `run_one_shot_openwhisk` in
      `helm/charts/backup-status/README.md`.
- [ ] 3.2 [test] Run `helm install --dry-run helm/charts/backup-status`
      against a vanilla cluster (kind) and assert install succeeds; run
      `openspec validate fix-p1-backup-status-crd-and-adapters --strict`;
      both green.
