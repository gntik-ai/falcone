# Tasks — fix-campaign-image-pull-policy

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: rebuilt executor (with the #517 fix) but the node kept the 9h-old image → F1 looked unfixed until `imagePullPolicy: Always` forced a re-pull.

## Implement (kind runtime AND shippable product)
- [ ] Use unique per-build tags (or `imagePullPolicy: Always`) in install.sh/executor-demo.yaml/values; drop the gateway-secret pre-create (chart owns it).
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A rebuild always runs the new code on the next deploy.

## Archive
- [ ] `openspec validate fix-campaign-image-pull-policy --strict`; `/opsx:archive fix-campaign-image-pull-policy` after merge.
