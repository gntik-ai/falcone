## Why

The SDK build pipeline carries seven related correctness, robustness, and
defensive-coding gaps clustered around concurrent regenerations, archive
construction, and credential / URL trust. From
`openspec/audit/cap-j1-openapi-sdk-builder.md`:

- **B15** (`services/openapi-sdk-service/actions/openapi-spec-regenerate.mjs:30-46`)
  — no advisory lock; two concurrent regenerations both insert and the
  deferred-unique constraint surfaces a 500 to the losing client.
- **B16** (`openapi-spec-regenerate.mjs:36`) — `markStaleSdkPackages` flips
  `'ready'` packages to `'stale'`; the eventual rebuild stores the OLD
  `spec_version` in the package row (misattribution).
- **B17** (`src/sdk-builder.mjs:35-41`) — `archiveDirectory` spawns
  `zip`/`tar` with `stdio: 'ignore'`; failed archive runs report only the
  exit code with no stderr capture.
- **B18** (`sdk-builder.mjs:65`) — the 240s timeout is fixed; large specs
  cannot complete and no retry exists.
- **B19** (`src/config.mjs:58`) — `normalizeServiceBaseUrl` is called with
  `allowBareInternalHttp: true` for `effectiveCapabilitiesBaseUrl`. Single-
  label hostnames (`kubernetes`) pass. SSRF risk if the env is attacker-
  controlled.
- **B20** (`sdk-builder.mjs:65` archive step) — `zip -r`/`tar -czf` runs
  with `cwd: outputPath` and `.` as root. Symlinks under the generated
  output could include content outside the directory.
- **B21** (`src/sdk-storage.mjs` upload) — `createReadStream(archivePath)`
  is passed to the S3 client but never explicitly closed; on failure the
  stream may leak.
- **G2, G12, G22, G24, G29** — same surfaces flagged.

## What Changes

- Take `pg_advisory_xact_lock(hashtext('openapi-spec-regen:' || workspaceId))`
  at the start of `openapi-spec-regenerate.main`; concurrent invocations
  serialise rather than racing the unique constraint.
- Fix the version stored on rebuilt `'stale'` packages: on rebuild, set
  `spec_version = current_spec_version` (not the OLD stored value).
- Capture archive stderr by switching to `stdio: ['ignore', 'ignore',
  'pipe']` and including the captured stream in any thrown error.
- Make the build timeout configurable: `SDK_BUILD_TIMEOUT_SECONDS`,
  default 240, max 1800. Surface the configured value in the error when
  the timeout fires.
- Drop the `allowBareInternalHttp` flag (or restrict to a static allow-
  list of internal service names). Reject single-label hosts unless they
  appear in a documented allow-list in `network.mjs`.
- Pass `--symlinks=ignore` (zip) / strip `--dereference` semantics (tar)
  to refuse to follow symlinks during archive construction; or pre-walk
  the output dir and refuse if a symlink is found.
- Wrap the upload stream in a `try { … } finally { stream.destroy(); }`
  block so failures release the file descriptor.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: SDK build pipeline serialises concurrent
  regenerations, captures archive stderr, validates internal URLs against
  an explicit allow-list, refuses to follow symlinks, and closes upload
  streams deterministically.

## Impact

- Affected code:
  `services/openapi-sdk-service/actions/openapi-spec-regenerate.mjs`,
  `services/openapi-sdk-service/src/sdk-builder.mjs`,
  `services/openapi-sdk-service/src/sdk-storage.mjs`,
  `services/openapi-sdk-service/src/network.mjs`,
  `services/openapi-sdk-service/src/config.mjs`.
- Migrations: none.
- Breaking changes: deployments relying on bare single-label internal
  hosts in `EFFECTIVE_CAPABILITIES_BASE_URL` outside the allow-list will
  fail at startup; intentional.
- Coordination: confirm the allow-list contains the production
  capability-manifest service hostname before merging.
