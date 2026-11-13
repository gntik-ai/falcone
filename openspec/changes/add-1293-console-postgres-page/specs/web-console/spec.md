# PostgreSQL inventory migration

## ADDED Requirements

### Requirement: Read-only relational hierarchy
The next console SHALL lazily serve `/console/postgres` inside the authenticated
shell without a route permission guard. It SHALL retain the legacy labels,
fixture values, selection hierarchy, breadcrumbs and connection snippets. All
page chrome SHALL come from matching es/en keys. No sample data SHALL render.

### Requirement: Request parity and section isolation
The page SHALL use console-api session requests for the nine inventory GETs,
four wizard metrics GETs, three dry-run PUTs and workspace-database POST. Every
paged GET SHALL begin with `page[size]=100`; security SHALL have no query.
Next SHALL use `page.nextCursor`; terminal pages SHALL retain Previous. Retry
SHALL resend only the failed section and clear stale data. Permission, missing
resource, server, network, loading and empty states SHALL remain local.

### Requirement: Safe previews and wizard parity
DDL PUTs SHALL use `dryRun: true` and `executionMode: preview`, preserve optional
view fields and fail without a PUT when context or query is missing. Missing
`ddlPreview` SHALL render an error. The wizard SHALL check quotas even on denial,
allow advancement while quota checks are pending, enforce workspace/name/quota
validation, reset configuration on engine change, and submit untrimmed names.
The success link SHALL target the selected engine's console route.

### Requirement: Shared pending route and rollback
The router SHALL export `pendingRouteElement(guard?: GuardKind)` and use it for
pending routes. The three existing rollback tests SHALL use that function with
unchanged assertions, flags and restoration. Replacing it with a migrated page
SHALL fail those rollback assertions. Removing the PostgreSQL migration flag
SHALL restore legacy handoff; `postgres/data` SHALL remain pending.

### Requirement: Accessibility and verification
Keyboard focus SHALL remain visible through breadcrumbs, tabs, pagers, retries,
preview closure and wizard closure. Wide content SHALL stay inside scrollable
containers at 375, 768 and 1280 pixels. The next-only mocked journey SHALL cover
both locales, exact requests, runtime health, axe and screenshot evidence.
Browser checks unavailable locally SHALL run in PR CI; visual approval SHALL
remain with the independent checker and operator.
