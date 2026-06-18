# Tasks — fix-executor-ferretdb-netpol-labels

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces the gap. `tests/blackbox/executor-ferretdb-netpol-label.test.mjs` (bbx-559-01..04): a deterministic manifest-contract test — RED when the executor pod lacks `app.kubernetes.io/name: control-plane-executor`, GREEN once both sides of the contract (the kind manifest label + the datastore `allowedAppComponents`) agree. (Live equivalent: executor mongo insert 500 timeout → 201 after the label.)

## Implement (kind runtime AND shippable product)
- [x] Set `app.kubernetes.io/name: control-plane-executor` on the executor pod template — `deploy/kind/executor-demo.yaml` (kept `app: falcone-cp-executor` so the Service selector still resolves).
- [x] CODE-REALITY CORRECTION: the chart has **no** `controlPlaneExecutor` Deployment template (the executor ships only via `deploy/kind/executor-demo.yaml` in this profile; the standard chart folds the data-plane into the control-plane pod). There is therefore no chart pod-template label to "align"; the contract is instead asserted against `ferretdb.networkPolicy.allowedAppComponents` (already lists `control-plane-executor`). No `apps/control-plane`/`services/*` change is applicable — this is a kind-deploy label defect only.

## Verify
- [x] `node --test tests/blackbox/executor-ferretdb-netpol-label.test.mjs` → 4/4 green. (Full suite + CI quality subset run in the batch barrier.)
- [ ] Acceptance (live): executor mongo CRUD 2xx on a clean deploy — folded into the consolidated live RED→GREEN verification on kind.

## Archive
- [ ] `openspec validate fix-executor-ferretdb-netpol-labels --strict`; archive in the batch (after the combined commit closing the issue).
