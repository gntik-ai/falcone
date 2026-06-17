## 1. Failing black-box test

- [ ] 1.1 Add a black-box/E2E test that issues a same-origin `/v1/*` request from the console host and asserts an API (JSON) response rather than the SPA HTML fallback. Confirm RED (HTML today).

## 2. Wire the edge

- [ ] 2.1 Deploy an ingress controller (or equivalent edge) and add routes so the console host's `/v1/*` paths reach the control-plane/gateway.

## 3. Verify

- [ ] 3.1 Re-run the edge-routing test — confirm the console reaches the API end-to-end in the deployed topology.
- [ ] 3.2 Run `bash tests/blackbox/run.sh` to confirm no regressions.
