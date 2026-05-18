## Why

The note sanitiser in `services/workspace-docs-service/src/note-sanitiser.mjs`
is a hand-rolled, single-pass transformer that leaks several classes of
malicious or oversized content into the docs surface. From
`openspec/audit/cap-k1-workspace-docs-service.md`:

- **B1** (`src/note-sanitiser.mjs:6-12`) — single-pass HTML entity decoding
  leaves double-encoded payloads (`&amp;lt;script&amp;gt;`) intact in storage;
  a consumer that decodes again at render time recovers an executable
  `<script>` tag.
- **B13** (`note-sanitiser.mjs:8-10`) — only `&lt;`, `&gt;`, `&amp;` are
  decoded. Numeric (`&#60;`, `&#x3c;`) and named (`&quot;`, `&nbsp;`) entities
  pass through and can re-emerge as tags after consumer decode.
- **B14** (`note-sanitiser.mjs:12`) — tag-stripping regex `/<[^>]+>/g` does
  not handle `>` inside quoted attributes (`<a href="x>y">…</a>`).
- **B15** (`note-sanitiser.mjs:14`) — length cap counts UTF-16 code units,
  not bytes; a 4096-char emoji payload is ~16 KB.
- **B16** (`note-sanitiser.mjs:14-17`) — `INVALID_NOTE_CONTENT` is emitted
  for both "empty" and "too long"; callers cannot tell which.

## What Changes

- Replace the hand-rolled sanitiser with a vetted HTML sanitiser
  (e.g. `sanitize-html`) configured to strip ALL tags and decode entities
  recursively until the output is stable.
- Validate both UTF-16 length AND byte length against
  `WORKSPACE_DOCS_NOTE_MAX_LENGTH`; the smaller must hold.
- Split `INVALID_NOTE_CONTENT` into `NOTE_CONTENT_EMPTY` and
  `NOTE_CONTENT_TOO_LONG` with distinct HTTP 422 codes.
- Add a `sanitiseNote` property-based test asserting that for any input,
  the sanitised output is stable under further sanitisation passes.

## Capabilities

### Modified Capabilities

- `workspace-management`: requirements on note sanitisation, length
  measurement, and error-code granularity.

## Impact

- **Affected code**: `services/workspace-docs-service/src/note-sanitiser.mjs`,
  `services/workspace-docs-service/actions/workspace-docs.mjs` (error
  mapping), `services/workspace-docs-service/package.json` (new dep).
- **Migration required**: none.
- **Breaking changes**: callers handling `INVALID_NOTE_CONTENT` must add
  branches for the two new codes; existing notes already persisted are not
  re-sanitised.
- **Cross-cutting**: if any console page renders `notes.content` as HTML
  (rather than text), that consumer becomes safe under the new contract.
