## 1. Curation logic

- [x] 1.1 `applyCuration(draft, curation)` → curated manifest: drop disabled tools, override descriptions, assign per-tool scopes (curator scope > suggestedScope), `status:'curated'`
- [x] 1.2 Validation: an enabled mutating tool with no scope is a violation; collect violations on the curated manifest
- [x] 1.3 `previewToolList(manifest)` → the resulting tool list (name/description/mutates/scope)

## 2. Publish gate

- [x] 2.1 `publishManifest(curated)` → `published` only if no violations and ≥1 enabled tool; else returns violations
- [x] 2.2 `isConnectable(manifest)` → true only for `published` (draft / un-published curated → not connectable)

## 3. Verify

- [x] 3.1 Unit tests: disable excludes; description+scope applied; mutating-without-scope violation; publish refused (violation / zero enabled) vs allowed; isConnectable only when published; preview shape
- [x] 3.2 `pnpm lint` + `openspec validate --strict` pass

## 4. Finalize

- [x] 4.1 Confirm the #392 invariant holds end-to-end: a draft (un-published) tool set is never connectable
