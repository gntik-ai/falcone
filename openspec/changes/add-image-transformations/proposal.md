# add-image-transformations

## Why

On-the-fly image transformation — request `?width=400&format=webp` and get a resized,
re-encoded JPEG-as-WebP back from the same URL that served the original — is the single
biggest UX win a storage capability can offer. Supabase calls it **Image Transformations**;
Cloudflare ships **Images**; Cloudinary built a company on it. Without it, every
front-end developer rolls their own resize-on-upload pipeline that always falls behind
device-pixel-ratio inflation, format proliferation (WebP → AVIF → JPEG XL), and
responsive-art-direction needs.

Falcone's [[data-services]] G1 already has an object storage adapter with presigned URLs.
Adding a transformation layer is mostly a CDN-cache-friendly proxy that calls libvips
under the hood and writes back to a derivative cache. The effort is small; the impact
is universal — every mobile and web tenant uses it the day it ships.

## What Changes

1. **New transformation endpoint as a `GET` query layer on the existing storage routes:**
   - `GET /v1/objects/{bucket}/{key}?width=&height=&fit=&quality=&format=&blur=`
     — when **any** transform parameter is present, the response is the derivative
     instead of the original.
   - Reserved transform parameter set:
     - `width`, `height` (integers, ≤ workspace-configured max, default 4096)
     - `fit` ∈ `cover|contain|fill|inside|outside` (sharp/libvips semantics)
     - `quality` (1–100, default 80)
     - `format` ∈ `auto|jpeg|png|webp|avif|jxl` (`auto` uses `Accept` header)
     - `blur` (0.3–1000 σ)
     - `rotate` (90 multiples)
     - `gravity` ∈ `auto|center|north|south|east|west|north-east|...`
     - `pixel_ratio` (1–4, multiplies width/height)
2. **Signed transformations** (optional per bucket): when `bucket.transformsSigned=true`,
   the URL must carry `?signature=<hmac>` over the canonical transform string, signed
   with the bucket-scoped transform key. Prevents tenant-billing-DoS via untrusted
   clients fabricating expensive transform combinations.
3. **Public-buckets variant:** a presigned-URL-free, public `GET` for public buckets
   that returns the derivative without authentication (CDN-cache-friendly).
4. **Derivative cache:** every derivative is written to a sibling object
   `_transforms/<sha256(transform-string)>/<key>` so repeat requests are O(1) at the
   storage backend; a per-bucket retention policy controls eviction.
5. **Per-bucket transformation policy:**
   - `GET|PUT /v1/storage/workspaces/{workspaceId}/buckets/{bucket}/transformations` —
     `{ enabled, allowedFormats[], maxWidth, maxHeight, signedRequired,
        cacheControlMaxAgeSeconds, signingKeyRotatedAt }`.
   - `POST .../transformations/signing-key:rotate` — rotate the bucket's transform key.
6. **Animated formats:** GIF and WebP/AVIF animation pass-through; transformation
   operations on animated assets explicitly opt-in via `?frame=` to extract a still.
7. **Limits & quotas:**
   - Plan dimensions: `storage.transforms.requests.per_minute`,
     `storage.transforms.payload_bytes_max`, `storage.transforms.cache_size_bytes_max`.
   - Per-request CPU budget enforced via libvips timeouts (default 5 s).
8. **Console:** the `ConsoleStoragePage` per-bucket detail gains a "Transformations"
   tab (toggle, limits, signed-required, current cache size, rotate-key).

## Impact

- **Affected specs**:
  - `openspec/specs/data-services/spec.md` — adds REQs for the transform query layer,
    bucket policy, derivative caching, and quotas.
- **Affected code**:
  - `services/adapters/src/storage-transformations.mjs` (new) — libvips wrapper,
    transform-string parser, signing, derivative-cache I/O.
  - `services/adapters/src/storage-bucket-object-ops.mjs` — branch on transform
    parameters and dispatch to the new module.
  - `apps/control-plane/openapi/families/storage.openapi.json` — document the reserved
    query parameters and `.../transformations` admin endpoints.
  - `services/provisioning-orchestrator/src/migrations/NNN-bucket-transforms.sql` —
    `bucket_transformation_policies` table.
  - `services/internal-contracts/src/storage-transformation-{request,policy}-v1.json`.
  - `apps/web-console/src/pages/ConsoleStoragePage.tsx` — bucket detail Transformations tab.
- **Dependencies**: none hard; benefits enormously from a CDN in front
  ([[deployment-and-operations]] decision — not required for ship).
- **No breaking changes** — additive; transform parameters are reserved query keys
  documented in storage OpenAPI; legacy callers that ignore them get the original.
