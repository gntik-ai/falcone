## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/workspace-docs-service/src/note-sanitiser.test.mjs` that
      submits `&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;` and
      asserts the stored output, when decoded by ANY consumer, never
      contains a literal `<script>`.
- [ ] 1.2 [test] Add a case asserting numeric (`&#60;`) and named
      (`&quot;`) entities are stripped or fully neutralised.
- [ ] 1.3 [test] Add a case feeding `<a href="x>y">payload</a>` and
      asserting no residual angle-bracket content survives.
- [ ] 1.4 [test] Add a case where a 4096-char emoji payload exceeds the
      configured BYTE cap; assert `NOTE_CONTENT_TOO_LONG` is thrown.
- [ ] 1.5 [test] Add separate cases asserting empty content throws
      `NOTE_CONTENT_EMPTY` and oversized throws `NOTE_CONTENT_TOO_LONG`.

## 2. Implementation

- [ ] 2.1 [fix] Replace `note-sanitiser.mjs:6-12` with a recursive decode
      loop until the result is stable, then run a vetted HTML sanitiser
      that strips all tags and decodes all entity forms.
- [ ] 2.2 [fix] Update `note-sanitiser.mjs:14` to check
      `Buffer.byteLength(cleaned, 'utf8')` in addition to UTF-16 length.
- [ ] 2.3 [fix] Split the error code at `note-sanitiser.mjs:14-17` into
      `NOTE_CONTENT_EMPTY` and `NOTE_CONTENT_TOO_LONG`; update the
      error-mapping table in `actions/workspace-docs.mjs:120-131` so both
      map to 422 with distinct codes.

## 3. Validation

- [ ] 3.1 [test] Re-run the K1 test suite plus `openspec validate
      fix-k1-xss-and-sanitiser --strict`; both green before merge.
- [ ] 3.2 [docs] Document the new error codes in
      `services/workspace-docs-service/README.md` (note CRUD section).
