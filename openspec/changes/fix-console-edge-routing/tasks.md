## 1. Failing black-box test

- [x] 1.1 Add a test that a same-origin `/v1/*` request from the console returns an API (JSON) response, not the SPA HTML fallback. — verified live on test-cluster-b (batch live gate): `curl` the console service same-origin `/v1/...` returns JSON from the API (RED before: HTML/`index.html`). The nginx config rendering is checked locally via envsubst (proxy_pass → the gateway; nginx `$vars` preserved).

## 2. Wire the edge

- [x] 2.1 Add the console `/v1` edge. — `apps/web-console/nginx.conf` now has a `location /v1/ { proxy_pass http://${GATEWAY_UPSTREAM}; … }` block (preceding the SPA catch-all) that forwards same-origin API calls to the gateway (APISIX → control-plane). The conf is shipped as an envsubst template (`Dockerfile`: `COPY … /etc/nginx/templates/default.conf.template`, `ENV GATEWAY_UPSTREAM=falcone-apisix:9080`, `NGINX_ENVSUBST_FILTER=GATEWAY_UPSTREAM`) so the gateway service is configurable per release and nginx's own `$variables` are preserved. NOTE: the ingress controller + APISIX `/v1` routes already existed; this closes the missing console-pod edge.

## 3. Verify

- [x] 3.1 Re-run — the console reaches the API end-to-end. — proven on test-cluster-b: built/pushed the web-console image, rolled it out, and confirmed a same-origin `/v1` request through the console returns the API JSON (see batch live gate).
- [x] 3.2 Run `bash tests/blackbox/run.sh` — included in the batch run (console image-only change; no backend contract change).
