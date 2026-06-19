# Tasks — fix-flow-trigger-master-key-failclosed

## Reproduce (test-first)
- [x] Added a failing black-box test
  (`tests/blackbox/flow-trigger-secret-key-failclosed.test.mjs`, bbx-trigkey-01..06) that
  imports `resolveTriggerSecretKey` and `createFlowTriggerRegistry` directly from
  `flow-trigger-registry.mjs` and asserts: resolver returns null in production without a key
  (bbx-trigkey-01); resolver returns the configured key in production (bbx-trigkey-02); a
  non-production profile returns a non-null dev key (bbx-trigkey-03); webhook registration
  throws 503 `TRIGGER_SECRET_KEY_UNCONFIGURED` in production without a key (bbx-trigkey-04);
  verifyWebhook returns false without a key (bbx-trigkey-05); registration succeeds and returns
  a one-time secret with a configured key (bbx-trigkey-06) — all failing against the original
  hardcoded-fallback code.

## Implement
- [x] New exported `resolveTriggerSecretKey()` function in
  `apps/control-plane/src/runtime/flow-trigger-registry.mjs` (lines 399–404): configured key
  wins; null in production when absent; dev key in non-production.
- [x] Registry `createFlowTriggerRegistry` default parameter updated to call
  `resolveTriggerSecretKey()` (line 417) instead of the inline `?? 'flow-trigger-dev-master-key'`
  fallback.
- [x] `registerWebhookTrigger` (lines 460–463): fail closed — throw
  `{ statusCode: 503, code: 'TRIGGER_SECRET_KEY_UNCONFIGURED' }` when `secretMasterKey` is null.
- [x] `verifyWebhook` (line 482): fail closed — return `false` immediately when `secretMasterKey`
  is null.
- [x] `deploy/kind/executor-demo.yaml` (lines 19, 162–163): add `in-falcone-flow-trigger-secret`
  Secret and inject `FLOW_TRIGGER_SECRET_KEY` into the executor container via `secretKeyRef`.

## Verify
- [x] All six black-box tests pass (bbx-trigkey-01..06); full black-box suite green (997/997 pass).
- [x] `resolveTriggerSecretKey()` exported and importable; registering with a configured key
  returns a one-time signing secret; dev fallback confirmed in non-production.
- [x] `deploy/kind/executor-demo.yaml` now provides `FLOW_TRIGGER_SECRET_KEY` via a Kubernetes
  Secret reference; executor running `NODE_ENV=production` gets the key at boot rather than
  activating the fail-closed path.

## Archive
- [ ] `openspec validate fix-flow-trigger-master-key-failclosed --strict`; archive after merge.
