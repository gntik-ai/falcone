## Why

The web-console static-serving paths did not consistently apply production-grade asset delivery
headers. The restricted-profile Node static servers served the SPA bundle with only
`content-type`, so hashed JavaScript and CSS assets were uncompressed and could not be cached
immutably. The kind nginx config also lacked the gzip and cache-control policy already present in
the production web-console nginx template.

Static bundle assets are content-hashed and safe to cache long term, while `index.html` must not be
cached because it is the boot document that points browsers at the current bundle. Compressible
bundle assets should use HTTP compression whenever the client advertises support.

## What Changes

- Add dependency-free HTTP compression to both Node static servers:
  - `deploy/kind/web-console/static-server.mjs`
  - `apps/web-console/static-server.mjs`
- The Node servers use `WEB_CONSOLE_STATIC_ROOT` and `PORT` env overrides for focused tests while
  preserving container defaults of `/app/dist` and `3000`.
- The Node servers negotiate Brotli first when `Accept-Encoding` includes `br`, otherwise gzip when
  it includes `gzip`, for JS, CSS, JSON, SVG, and JSON-like source map assets.
- The Node servers set `Vary: Accept-Encoding` for compressible asset responses, immutable
  `Cache-Control` for `/assets/*`, and `Cache-Control: no-store` for `index.html` and SPA fallback
  responses.
- Align `deploy/kind/web-console/nginx.conf` with gzip, `gzip_vary`, immutable asset caching, and
  no-store `index.html` handling while preserving `/healthz` and SPA fallback behavior.
- Keep `apps/web-console/nginx.conf` consistent by enabling `gzip_vary` and including both
  JavaScript MIME types in `gzip_types`.
- Add focused Node unit tests that start both real static server entrypoints over HTTP with a
  temporary dist root and assert compression, cache headers, non-compressible asset behavior,
  `/v1` proxy preservation for the deploy server, and nginx source parity.
- Add reference documentation for web-console static asset delivery.

## Contract / Wire Impact

This change affects HTTP response headers and optional response-body transfer encoding for the
web-console static bundle only. It does not change backend API endpoints, request/response schemas,
status codes, auth claims, real-time event shapes, OpenAPI, generated clients, or frontend shared
types. No public API code generation changes are expected.

## Capabilities

### Added Capabilities

- `web-console`: static bundle serving paths provide negotiated HTTP compression and cache-safe
  headers for hashed assets and the SPA boot document.
