## Why

The Observability Audit tab already calls the audit-export route, and the current control-plane
contract returns a real `AuditExportManifest` for completed exports. The web console still treated
the call as `Promise<void>` and discarded the POST response, then showed
`Exportación iniciada correctamente.` for every fulfilled 2xx response. That made a completed
manifest invisible to operators and would also report success for acknowledged/pending/no-artifact
responses.

## What Changes

- Make `apps/web-console/src/lib/console-metrics.ts::exportAuditRecords` return a typed audit
  export result from the existing POST response.
- Update `ConsoleObservabilityPage` so the Audit tab distinguishes:
  - completed/produced manifests with `exportId`, `itemCount`, `maskedItemCount`, and `items`;
  - acknowledged/pending/no-artifact responses, using the backend message when present and not
    implying a downloadable export;
  - request failures, shown as explicit export errors.
- Surface completed manifests with a `Descargar JSON` action that downloads the manifest returned by
  the API.
- Add focused web-console Vitest coverage for the client return value and the completed vs
  no-artifact UI states.
- Document the console-side audit export result handling under `docs/reference/architecture/`.

## Contract / Wire Impact

No endpoint, status-code, schema, OpenAPI, route catalog, generated SDK, or backend behavior change
is required. This fix consumes the already-declared audit-export response contract:
`POST /v1/metrics/{tenants|workspaces}/{id}/audit-exports` returns `AuditExportManifest` when an
export artifact is produced. Public API validation and generation should produce no diff.

## Capabilities

### Modified Capabilities

- `web-console`: add a requirement that audit export feedback reflects the real response outcome,
  never reports unqualified success for acknowledged/no-artifact responses, and surfaces an
  actionable download when a manifest is produced.
