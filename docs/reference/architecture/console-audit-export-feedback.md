# Console audit export feedback

The Observability Audit tab uses the existing metrics audit-export routes:

```text
POST /v1/metrics/tenants/{tenantId}/audit-exports
POST /v1/metrics/workspaces/{workspaceId}/audit-exports
```

Those routes are already defined by the public metrics contract as audit export preview routes. When
the backend produces an export, the response is an `AuditExportManifest` with an `exportId`,
`itemCount`, `maskedItemCount`, and `items`. The console must treat that response as the source of
truth rather than treating any 2xx status as success.

## Console states

- **Completed/produced manifest**: if the response includes a manifest artifact (`exportId`,
  numeric `itemCount`, and an `items` array), the Audit tab shows the export id, exported record
  count, masked-record count, backend status, and a `Descargar JSON` button. The download is the
  manifest returned by the API, serialized as JSON in the browser; it does not require an additional
  backend route.
- **Acknowledged or pending without artifact**: if the response is accepted/pending or otherwise
  lacks an artifact, the Audit tab shows an unavailable/pending information state. It uses the
  backend `message` when present and does not show the previous generic success copy or a download
  button.
- **Failure**: if the POST fails, the Audit tab shows an explicit export error and does not render
  success feedback or download controls.

## Contract note

This behavior does not change the public API. It aligns the web console with the existing
`AuditExportManifest` response schema in the metrics OpenAPI family and keeps no-artifact
acknowledgements visually distinct from completed exports. No generated API artifacts or shared
contracts should change for this fix.
