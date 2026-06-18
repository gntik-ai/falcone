# Tasks — fix-campaign-image-pull-policy

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: rebuilt executor (with the #517 fix) but the node kept the 9h-old image → F1 looked unfixed until `imagePullPolicy: Always` forced a re-pull. — `tests/blackbox/campaign-image-pull-policy.test.mjs` (bbx-561-01..04): asserted the executor + campaign images used `IfNotPresent` (failing pre-fix) and that no ACTIVE statement pre-creates the gateway secret.

## Implement (kind runtime AND shippable product)
- [x] Use unique per-build tags (or `imagePullPolicy: Always`) in install.sh/executor-demo.yaml/values; drop the gateway-secret pre-create (chart owns it). — Chose `imagePullPolicy: Always` (robust against the in-cluster local registry localhost:30500): `deploy/kind/executor-demo.yaml` executor container → `Always` (MCP_SELF_BASE_URL env preserved); `tests/live-campaign/values-campaign.yaml` control-plane + web-console `image.pullPolicy: Always`. The `in-falcone-gateway-shared-secret` pre-create in `tests/live-campaign/make-secrets.sh` is dropped (commented out) with a #561 note — the chart self-manages it (templates/gateway-shared-secret.yaml).
- [x] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable. — The affected workloads are the kind/campaign harness files above; no shippable-product copy carries the campaign reusable tag (the chart defaults stay `IfNotPresent` with stable release tags, which is correct for non-rebuild deploys).

## Verify
- [x] Black-box suite green; the live 2-tenant probe now passes. — `bash tests/blackbox/run.sh` → 834/834 pass.
- [x] Acceptance: A rebuild always runs the new code on the next deploy. — Executor + campaign control-plane/web-console images pull `Always`, so a rebuild re-pushed to localhost:30500 is re-pulled on the next deploy; `helm install` no longer conflicts on the gateway secret (chart-owned).

## Archive
- [ ] `openspec validate fix-campaign-image-pull-policy --strict`; `/opsx:archive fix-campaign-image-pull-policy` after merge. (validate run in this session; archive deferred to the batching orchestrator.)
