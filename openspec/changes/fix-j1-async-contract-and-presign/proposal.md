## Why

The SDK generate endpoint advertises an asynchronous contract while running
synchronously, and the "already ready" early return serves stale presigned
URLs. From `openspec/audit/cap-j1-openapi-sdk-builder.md`:

- **B7** (`services/openapi-sdk-service/actions/sdk-generate.mjs:88-104`) —
  the handler awaits `buildSdk` + `uploadSdkArtefact` + `updateSdkPackageStatus`
  + Kafka emit synchronously and then returns `202` with `status: 'pending'`
  and a `statusUrl`. By the time the response leaves, the package is already
  `ready`; a client polling the status URL sees `'ready'` on the first poll
  and the `'pending'` shape was never observable.
- **B8** (`sdk-generate.mjs:74-87`) — the early-return for already-ready
  packages returns the stored `downloadUrl` without checking
  `urlExpiresAt`. With the default 86400s TTL, a re-request 25h later
  returns a 403-on-use URL.
- **G20** (G-S6.3) — same async-contract mismatch flagged as a gap.
- **G21** (G-S6.4) — stale URL re-issue gap flagged.

## What Changes

- Pick the truthful semantic. The build is fast enough today that the
  contract should be synchronous: change the success response to `200`
  with `status: 'ready'` and the actual `downloadUrl`/`urlExpiresAt`. The
  `statusUrl` continues to exist for backwards compatibility but the body
  no longer lies about state.
- In the early-return at `:74-87`, check whether `urlExpiresAt` is within
  10% of expiry; if so, re-presign before returning. If the underlying
  archive is missing in S3 (verified via HEAD), reset the row to
  `'building'` and rebuild.
- Add a new `205 SDK_REBUILT` response code if re-presigning required a
  fresh build (caller observes a different `urlExpiresAt`).

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: SDK generation response truthfully reflects
  the package state; expired or near-expired presigned URLs are refreshed
  before being returned.

## Impact

- Affected code: `services/openapi-sdk-service/actions/sdk-generate.mjs`,
  `services/openapi-sdk-service/src/sdk-storage.mjs` (new
  `headSdkArtefact`).
- Migrations: none.
- Breaking changes: callers expecting `202 'pending'` on the happy path
  now receive `200 'ready'` with the download URL inline; the OpenAPI
  contract for this endpoint must be regenerated. The `statusUrl` field
  remains for callers that want to poll after a `205 SDK_REBUILT`.
- Coordination: regenerate `/v1/workspaces/{id}/sdks` schema in the
  unified OpenAPI doc before merge.
