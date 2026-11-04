## ADDED Requirements

### Requirement: Console observability page

The next console SHALL serve `/console/observability` through its migrated flag and a lazy
dispatch. It SHALL compose the usage-analytics layout from gntik-ui 0.11.0 with explicit props and
complete es-default/en copy, accessible names and announcements.

#### Scenario: Workspace scope load

- **WHEN** a user with an active workspace opens the route
- **THEN** it SHALL send exactly GET `workspaces/{}/overview` and `usage` with no query string and
  GET `workspaces/{}/series?metricKey=api_requests&window=24h`.
- **AND** a user holding `tenant.audit.read` SHALL also send GET `workspaces/{}/audit-records` with
  `page[size]=50&sort=-eventTimestamp`.
- **AND** changing the window to 7d SHALL refetch only overview, usage and the series with `window=7d`.

#### Scenario: Tenant scope

- **WHEN** no workspace is active
- **THEN** it SHALL send GET `tenants/{}/overview` and `usage` with no series or window request.
- **AND** the window select SHALL be disabled with the single option `Sin ventana activa` and the
  legacy reason linked through `aria-describedby`.
- **AND** `Reintentar` SHALL re-send only the two metrics requests.

#### Scenario: Series surface

- **WHEN** the series points are empty
- **THEN** the usage points SHALL be plotted, and with none the page SHALL show
  `Sin datos de serie en este periodo`.
- **AND** the chart card SHALL never render its sample data or a range toggle.

#### Scenario: Audit paging

- **WHEN** `page.hasMore` is true
- **THEN** `Cargar mas` SHALL send `page[after]=<nextCursor>` with the same filters and append rows.
- **AND** a failed next page SHALL keep the loaded rows and show an error-panel with `Reintentar`
  for the same cursor.
- **AND** a failed first page SHALL show no stale record.

#### Scenario: Scope and filter changes

- **WHEN** the tenant or workspace changes
- **THEN** loaded pages, the open drawer, export feedback and retry state SHALL be discarded.
- **AND** a late response for the old scope or old filters SHALL be neither rendered nor appended.

#### Scenario: Export

- **WHEN** a user exports the audit
- **THEN** the page SHALL POST `{ filters }` to the active scope's `audit-exports` with the button
  disabled and `aria-busy`.
- **AND** a manifest needs a non-empty `exportId`, a numeric `itemCount` and an `items` array;
  anything else SHALL show the unavailable warning and no download.
- **AND** a failed export SHALL show an error-panel with the request id, and `Reintentar` SHALL
  re-POST the exact body and scope of the failed attempt even if the filters changed afterwards.

#### Scenario: Restricted role

- **WHEN** the role lacks `tenant.audit.read`
- **THEN** the Auditoria tab SHALL NOT render and no `audit-records` or `audit-exports` request
  SHALL be sent.
