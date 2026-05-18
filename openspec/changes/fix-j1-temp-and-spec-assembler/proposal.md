## Why

The SDK builder leaks temp directories on every build, the spec assembler
pushes `undefined` into `spec.tags` on malformed modules, and version-bump
semantics ignore content changes. From
`openspec/audit/cap-j1-openapi-sdk-builder.md`:

- **B3** (`services/openapi-sdk-service/src/sdk-builder.mjs:51,71`) — the
  `finally` block removes only `specPath`, leaving the `tempRoot`
  containing `output/` (5-50 MB), `spec.json`, and the resulting archive
  on disk after every build. Disk fills indefinitely on long-lived
  runtimes.
- **B5** (`src/spec-assembler.mjs:67`) — `spec.tags.push(module.tag)`
  without checking. A capability module file lacking a `tag` field pushes
  `undefined` into `spec.tags`, corrupting the published OpenAPI document
  (validators reject `tags: [undefined]`).
- **B6** (`spec-assembler.mjs:39-47`) — `computeNextVersion` considers only
  the tag-set delta. Editing `auth.paths.json` to add a new endpoint
  produces only a PATCH bump even though the API surface changed. The
  `contentHash` IS computed at `:76` but the version doesn't reflect it.
- **G7-G9, G26** — same surfaces flagged as gaps.

## What Changes

- Replace `await rm(specPath)` in `sdk-builder.mjs:71` with `await
  rm(tempRoot, { recursive: true, force: true })` inside the `finally`
  block so the entire scratch dir is removed after upload (success and
  failure paths).
- Add a defensive check in `spec-assembler.mjs:67`: if `module.tag` is
  missing or not an object, throw a structured
  `SpecAssemblyError('TAG_MISSING')` naming the capability id; do NOT
  push `undefined`.
- Extend `computeNextVersion` to take the previous `contentHash` and the
  newly-computed `contentHash`. When the tag set is unchanged but the
  content hash differs, bump MINOR instead of PATCH (a content change with
  no surface change). When the tag set changes, retain existing
  MAJOR/MINOR logic.
- Validate capability module JSON at load time (warm `moduleCache`):
  ensure every module has `tag`, `paths`, `components.schemas` shapes
  before serving any spec.

## Capabilities

### Modified Capabilities

- `gateway-and-public-surface`: SDK builder cleans up scratch space after
  every run; spec assembler validates capability modules and bumps
  versions based on both tag and content deltas.

## Impact

- Affected code:
  `services/openapi-sdk-service/src/sdk-builder.mjs`,
  `services/openapi-sdk-service/src/spec-assembler.mjs`,
  `services/openapi-sdk-service/capability-modules/*.json` (validation
  only).
- Migrations: none.
- Breaking changes: version bumps for content-only edits now produce
  MINOR rather than PATCH; consumers parsing the version number to detect
  surface changes will now see them. The OpenAPI changelog will reflect
  this once.
- Out of scope: artefact retention policy at S3 (tracked under
  `harden-j1-build-pipeline`).
