# Tasks — fix-install-health-gate-probes

## Reproduce (test-first)
- [x] Root cause confirmed from code: the kind control-plane serves `/healthz`+`/readyz`
      (`deploy/kind/control-plane/server.mjs:246`) but apisix route 1010 proxied `/health` → control-plane
      `/health` → 404; and the ferretdb TCP probe ran from an unlabelled smoke pod the ferretdb
      NetworkPolicy (`charts/in-falcone/templates/ferretdb-networkpolicy.yaml`) does not admit.

## Implement (kind runtime AND shippable product as applicable)
- [x] `deploy/kind/apisix/apisix.yaml` route 1010: add `proxy-rewrite uri: /healthz` so the gateway
      `/health` route resolves to the control-plane health endpoint (200) instead of 404.
- [x] `tests/live-campaign/install.sh`: `probe_tcp` accepts an optional pod-label; the ferretdb probe
      labels its smoke pod `app.kubernetes.io/name=control-plane-executor` (a netpol-admitted component).

## Verify
- [x] `bash -n tests/live-campaign/install.sh` (syntax OK); `deploy/kind/apisix/apisix.yaml` parses with the rewrite.
- [x] The label matches the ferretdb netpol allowlist (`allowedAppComponents` → `app.kubernetes.io/name: control-plane-executor`).
- [x] Acceptance: the health gate passes when the platform is actually healthy.

## Archive
- [ ] `openspec validate fix-install-health-gate-probes --strict`; `/opsx:archive fix-install-health-gate-probes` after merge.
