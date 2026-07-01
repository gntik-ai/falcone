## Why

The web-console boot document declared `/favicon.svg` as the SVG-capable primary favicon, but that
asset was a 478 KB SVG wrapper around a base64-embedded PNG. Browsers that prefer SVG favicons
therefore fetched a multi-hundred-KB raster payload for a tiny tab icon, even though the existing
PNG fallback is only a few KB.

The primary favicon should be cheap to fetch and cache, and SVG favicon assets should remain true
vector files rather than base64 raster containers.

## What Changes

- Replace `apps/web-console/public/favicon.svg` with a compact vector SVG asset under 10 KB.
- Keep the existing `favicon.png` fallback declaration unchanged for browsers that do not use SVG
  favicons.
- Add a focused Node static asset regression test that reads `index.html`, resolves the declared
  SVG-capable primary favicon, and asserts that the fetched asset exists, is <= 10 KB, and does not
  embed a base64 raster image.
- Document the web-console favicon weight policy alongside the existing static asset delivery
  reference.

## Contract / Wire Impact

This change affects only a web-console static asset body. It does not change backend API endpoints,
request/response schemas, status codes, auth claims, real-time event shapes, OpenAPI, generated
clients, or frontend shared types. No public API code generation changes are expected.

## Capabilities

### Added Capabilities

- `web-console`: the declared SVG-capable favicon is a lightweight static icon asset and is not a
  base64-embedded raster image.
