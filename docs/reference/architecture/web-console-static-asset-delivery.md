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

Every static-serving path also sends the baseline browser security headers for the console shell and
assets:

```http
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

The CSP is the defense-in-depth boundary for the current console session model: the auth API still
returns the console `tokenSet`, and the frontend still stores it in session storage for bearer
requests. To keep arbitrary page script from becoming an easy full-session exfiltration path, static
serving constrains script execution to same-origin bundle files, omits `unsafe-inline` and
`unsafe-eval` from `script-src`, disables plugin/object execution, and denies all framing with both
`frame-ancestors 'none'` and `X-Frame-Options: DENY`. `style-src 'unsafe-inline'` is intentionally
limited to styles because several existing React components use inline style attributes.

For nginx, remember that a `location` block with its own `add_header` does not inherit headers from
the parent server block. Static locations repeat the security headers so direct `/index.html`,
`/assets/*`, and SPA fallback responses stay protected. The production template keeps these headers
out of the `/v1/` proxy location so API response headers are not changed by static-serving hardening.

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
