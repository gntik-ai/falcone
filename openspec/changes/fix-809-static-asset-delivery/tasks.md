## 1. Reproduce / encode the contract

- [x] 1.1 Confirm the reported roots: both Node static servers only set `content-type`, and the
  kind nginx config lacks gzip and cache-control headers.
- [x] 1.2 Add focused unit coverage that starts both Node static servers over HTTP with a temporary
  dist root and requests JS, CSS, JSON, SVG, image assets, `index.html`, SPA fallback paths, and
  `/healthz`.
- [x] 1.3 Add coverage that the deploy/kind Node static server still proxies `/v1/*` before the SPA
  fallback.
- [x] 1.4 Add source assertions that production nginx and kind nginx declare gzip, `gzip_vary`,
  immutable `/assets/*` cache-control, no-store `index.html`, and SPA fallback behavior.

## 2. Fix

- [x] 2.1 Add zero-dependency Brotli/gzip negotiation to
  `deploy/kind/web-console/static-server.mjs`.
- [x] 2.2 Add the same zero-dependency Brotli/gzip negotiation to
  `apps/web-console/static-server.mjs`.
- [x] 2.3 Set `Vary: Accept-Encoding` on compressible Node static asset responses.
- [x] 2.4 Set `Cache-Control: public, max-age=31536000, immutable` for Node `/assets/*` responses
  and `Cache-Control: no-store` for Node `index.html` and SPA fallback responses.
- [x] 2.5 Align `deploy/kind/web-console/nginx.conf` with gzip, `gzip_vary`, immutable assets,
  no-store `index.html`, and existing `/healthz` and SPA fallback behavior.
- [x] 2.6 Keep `apps/web-console/nginx.conf` consistent for gzip `Vary` and JavaScript MIME types.

## 3. Wire / contract / docs / OpenSpec

- [x] 3.1 Leave OpenAPI, generated clients, shared types, backend routes, auth claims, and real-time
  event shapes unchanged because this is static asset delivery behavior.
- [x] 3.2 Add `docs/reference/architecture/web-console-static-asset-delivery.md`.
- [x] 3.3 Materialize this OpenSpec change under
  `openspec/changes/fix-809-static-asset-delivery/`.

## 4. Verify

- [x] 4.1 Run `node --test tests/unit/web-console-static-server.test.mjs`.
- [x] 4.2 Run `openspec validate fix-809-static-asset-delivery --strict`.
- [x] 4.3 Run `npm run validate:openapi`.
- [x] 4.4 Run `npm run generate:public-api` and confirm it produces no diff.
- [x] 4.5 Run `git diff --check`.
