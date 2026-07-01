# Tasks - fix-799-console-security-headers-token-storage

## 1. Reproduce / encode the issue

- [x] Confirm both Node static servers previously served static responses with content/cache
      headers only and no CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or
      Permissions-Policy.
- [x] Confirm the frontend stores the console `tokenSet` in JS-accessible `sessionStorage`, so the
      minimal accepted mitigation is a strict CSP rather than a backend cookie migration.
- [x] Add focused HTTP regression coverage for `/`, `/login`, direct `index.html`, SPA fallback,
      and assets on both Node static server entrypoints.

## 2. Fix

- [x] Add static response security headers to `deploy/kind/web-console/static-server.mjs`.
- [x] Add the same static response security headers to `apps/web-console/static-server.mjs`.
- [x] Keep CSP script execution constrained to same-origin scripts and deny framing with both CSP
      `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- [x] Mirror the same header policy in `apps/web-console/nginx.conf` and
      `deploy/kind/web-console/nginx.conf`.
- [x] Preserve existing compression, cache-control, SPA fallback, `/healthz`, and kind `/v1/*`
      proxy behavior.

## 3. Wire / contract / docs / OpenSpec

- [x] Leave auth response shape, cookies, backend routes, OpenAPI, generated clients, shared types,
      auth claims, and real-time event shapes unchanged because the accepted fix is static-serving
      CSP/header hardening.
- [x] Materialize this OpenSpec change under
      `openspec/changes/fix-799-console-security-headers-token-storage/`.
- [x] Update the web-console static asset delivery documentation with the security header policy.

## 4. Verify

- [x] Run `node --test tests/unit/web-console-static-server.test.mjs`.
- [x] Run `openspec validate fix-799-console-security-headers-token-storage --strict`.
- [x] Run `npm run validate:openapi`.
- [x] Run `npm run generate:public-api` and confirm it produces no tracked diff.
- [x] Run `git diff --check`.
