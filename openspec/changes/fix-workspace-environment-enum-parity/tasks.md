# Tasks — fix-workspace-environment-enum-parity

## Reproduce (test-first)
- [x] Added failing black-box test `tests/blackbox/openapi-workspace-environment-enum-parity.test.mjs`
  (`bbx-env-enum-01`) that reads the OpenAPI document
  (`apps/control-plane/openapi/control-plane.openapi.json`) and the live
  `ENVIRONMENT_CATALOG` literal from `deploy/kind/control-plane/b-handlers.mjs`
  and asserts the `WorkspaceEnvironment` enum contains every live catalog value,
  including `preview` — was RED while `preview` was absent from the enum.

## Implement
- [x] `apps/control-plane/openapi/control-plane.openapi.json`:
  added `"preview"` to `components.schemas.WorkspaceEnvironment.enum`, bringing
  the published OpenAPI contract into parity with `ENVIRONMENT_CATALOG` in
  `deploy/kind/control-plane/b-handlers.mjs`.

## Verify
- [x] `tests/blackbox/openapi-workspace-environment-enum-parity.test.mjs` passes
  (1/1 GREEN: `bbx-env-enum-01`).
- [x] `bash tests/blackbox/run.sh` — full black-box suite green (997 pass).

## Archive
- [ ] `openspec validate fix-workspace-environment-enum-parity --strict`; archive after merge.
