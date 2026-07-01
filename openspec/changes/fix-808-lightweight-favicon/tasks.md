## 1. Reproduce / encode the contract

- [x] 1.1 Confirm `apps/web-console/index.html` declares `/favicon.svg` as the SVG-capable primary
  favicon.
- [x] 1.2 Confirm the existing `apps/web-console/public/favicon.svg` is 478,739 bytes and embeds a
  `data:image/png;base64` payload.
- [x] 1.3 Add focused static asset coverage that follows the declared primary favicon from
  `index.html` and asserts that the fetched asset is <= 10 KB and is not a base64 raster embedded in
  SVG.

## 2. Fix

- [x] 2.1 Replace `apps/web-console/public/favicon.svg` with a compact true vector SVG.
- [x] 2.2 Keep the existing `favicon.png` fallback declaration intact.

## 3. Wire / contract / docs / OpenSpec

- [x] 3.1 Leave OpenAPI, generated clients, shared types, backend routes, auth claims, and real-time
  event shapes unchanged because this is web-console static asset behavior only.
- [x] 3.2 Add favicon static icon weight guidance to the web-console static asset delivery
  reference documentation.
- [x] 3.3 Materialize this OpenSpec change under
  `openspec/changes/fix-808-lightweight-favicon/`.

## 4. Verify

- [x] 4.1 Run `node --test tests/unit/web-console-static-server.test.mjs`.
- [x] 4.2 Run `openspec validate fix-808-lightweight-favicon --strict`.
- [x] 4.3 Run `npm run generate:public-api` and confirm it produces no tracked diff.
- [x] 4.4 Run `git diff --check`.
- [x] 4.5 Run `npm run validate:openapi`.
