# fix-799-console-security-headers-token-storage

## Why

Issue #799 identified that the web console static-serving paths returned the SPA shell and assets
without baseline browser security headers. In particular, `/login` could be rendered inside a
cross-origin iframe and the console's JS-accessible session storage carried the access/refresh token
set without any Content-Security-Policy limiting script execution.

The smallest compatible hardening is to add a strict static-serving CSP and clickjacking headers to
the console shell and assets. That satisfies the issue's accepted mitigation without changing the
existing auth API response body, cookie behavior, OpenAPI contract, generated SDKs, or frontend API
types.

## What Changes

- Add baseline security response headers to both Node static servers:
  - `deploy/kind/web-console/static-server.mjs`
  - `apps/web-console/static-server.mjs`
- Mirror the same policy in both nginx static-serving configs:
  - `apps/web-console/nginx.conf`
  - `deploy/kind/web-console/nginx.conf`
- The policy includes:
  - `Content-Security-Policy` with `frame-ancestors 'none'` and `script-src 'self'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy`
- The CSP denies arbitrary framing, forbids plugin/object execution, constrains scripts to same
  origin without `unsafe-inline` or `unsafe-eval`, and keeps console network traffic same-origin.
  `style-src 'unsafe-inline'` is retained because the existing React UI uses inline style
  attributes; script execution remains constrained.
- Extend the focused static-server unit test to start both real Node entrypoints over HTTP and
  assert headers/CSP on `/`, `/login`, `/index.html`, SPA fallback paths, and assets.
- Extend nginx source assertions so direct `index.html` and `/assets/*` locations carry the same
  security headers despite nginx `add_header` inheritance rules.
- Document the web-console security header policy.

## Contract / Wire Impact

This change affects only HTTP response headers for web-console static content. It does not change
backend API endpoints, request/response schemas, status codes, auth claims, cookies, real-time event
shapes, OpenAPI, generated clients, or frontend shared types. No public API code generation changes
are expected.

## Capabilities

### Added Capabilities

- `web-console`: the console shell and assets are served with baseline browser security headers,
  refuse cross-origin framing, and apply a strict script-origin CSP around the existing
  JS-accessible console session storage.
