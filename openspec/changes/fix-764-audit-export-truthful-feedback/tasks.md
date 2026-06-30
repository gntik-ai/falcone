## 1. Reproduce / encode the contract

- [x] 1.1 Confirm the current backend audit-export route returns a real manifest on latest
  `origin/main` and the remaining defect is the web-console client/page dropping that response.
- [x] 1.2 Add/adjust `console-metrics` coverage so `exportAuditRecords` must return the audit export
  response instead of resolving `void`.
- [x] 1.3 Add page coverage for a completed manifest showing export id, counts, and download.
- [x] 1.4 Add page coverage for an accepted/no-artifact response showing non-success information
  without the generic success message or download action.

## 2. Fix

- [x] 2.1 Add typed audit export result/manifest types to the console metrics client.
- [x] 2.2 Return the existing POST response from `exportAuditRecords`.
- [x] 2.3 Replace the Audit tab's unconditional success message with structured export feedback:
  artifact, unavailable/pending, and error states.
- [x] 2.4 Add a `Descargar JSON` action for completed/produced manifests.

## 3. Wire, frontend, docs, and OpenSpec

- [x] 3.1 Confirm no OpenAPI/source contract change is needed because the existing contract already
  defines `AuditExportManifest` for the audit-export POST routes.
- [x] 3.2 Add architecture documentation for console audit export result handling.
- [x] 3.3 Materialize this OpenSpec change under
  `openspec/changes/fix-764-audit-export-truthful-feedback/`.

## 4. Verify

- [x] 4.1 Run focused web-console Vitest tests for `console-metrics` and
  `ConsoleObservabilityPage`.
- [x] 4.2 Run `openspec validate fix-764-audit-export-truthful-feedback --strict`.
- [x] 4.3 Run `npm run validate:public-api`.
- [x] 4.4 Run `npm run validate:openapi`.
- [x] 4.5 Run `npm run generate:public-api` and confirm no generated diff.
- [x] 4.6 Run `git diff --check`.
