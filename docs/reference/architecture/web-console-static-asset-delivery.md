# Web console static asset delivery

Falcone serves the built web-console SPA through several bundled runtime paths:

- `apps/web-console/nginx.conf` is the production nginx template used by
  `apps/web-console/Dockerfile`.
- `deploy/kind/web-console/static-server.mjs` is the restricted-profile Node server used by the
  kind and release static-server images. It also proxies same-origin `/v1/*` requests to
  `GATEWAY_UPSTREAM` before the SPA fallback.
- `apps/web-console/static-server.mjs` is the app-local test/deploy Node static server.
- `deploy/kind/web-console/nginx.conf` is the kind nginx static-serving config.

## Header policy

The web console bundle is emitted with content-hashed files under `/assets/`. Those files are
immutable for a given build, so every static-serving path sends:

```http
Cache-Control: public, max-age=31536000, immutable
```

for `/assets/*` responses.

`index.html` is different. It is the SPA boot document and can change whenever a new build points at
new hashed assets. Every static-serving path sends:

```http
Cache-Control: no-store
```

for `index.html`. The Node static servers also apply the same `no-store` policy to SPA fallback
responses that return `index.html` for client-side routes.

## Icon asset policy

The SVG-capable favicon declared by `apps/web-console/index.html` is part of the console boot path.
It must remain a lightweight true vector SVG, with a target budget of roughly 10 KB or less. Do not
embed raster icon artwork as `data:image/*;base64` inside `favicon.svg`; keep raster fallbacks such
as `favicon.png` as separate small files.

## Compression policy

Compressible bundle assets are JavaScript, CSS, JSON, and SVG. The Node static servers use only
Node built-ins and do not write precompressed files to disk. They inspect `Accept-Encoding` and:

- return Brotli (`content-encoding: br`) when the client accepts `br`;
- otherwise return gzip (`content-encoding: gzip`) when the client accepts `gzip`;
- leave non-compressible assets such as PNG, ICO, and WOFF2 uncompressed.

The Node static servers set `Vary: Accept-Encoding` on compressible asset responses so caches do not
serve a compressed variant to a client that did not request it. The nginx paths enable gzip and
`gzip_vary on` for the same reason. Stock nginx images do not include Brotli, so nginx paths provide
gzip compression.

## Test and runtime overrides

The Node static servers keep their container defaults:

- `WEB_CONSOLE_STATIC_ROOT=/app/dist`
- `PORT=3000`

Focused tests may override those variables to serve a temporary `dist` directory on an ephemeral
port. The overrides are test hooks only; they do not change the container defaults or require extra
runtime dependencies.
