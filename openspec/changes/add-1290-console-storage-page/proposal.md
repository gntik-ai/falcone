# Migrate workspace storage to the next console

Issue #1290 revision 3 migrates `/console/storage` beside the untouched legacy page.
Blueprint `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`;
page entry `console-storage-page`, SHA256
`0443ed57447eb11e586b07e1ce133db7ea7a16342e929148fd8d6899ae292a9b`.
Assigned source snapshot: `06e774492a072c50d494a75db144330e6af3545a`.

## Behavior

Use the installed gntik-ui 0.11.0 kit and tokens 0.3.0 to compose the resource-index
pattern with the legacy two-column layout. Translate all chrome through the es/en
`pages.console-storage-page` catalogs. Tables are not client-paginated: buckets
remain the first 100 tenant records filtered by workspace; object pages append
50 records using the opaque cursor.

All reads and writes use console-api's unchanged session primitive. Revision 3
supersedes the earlier no-replay 401 clauses: a successful shared refresh permits
one authenticated replay, including POST, PUT and DELETE. A repeated 401 or rejected
refresh redirects to login. A DELETE replay answered 404 is reported deleted.
There is no page-level authenticated replay.

After an uncertain create network outcome, Retry only reads buckets. It reports
creation only for a complete inventory containing exactly one exact-name match in
the active workspace with a previously absent resource ID. Derived names, cursor
pages, pre-existing IDs, ambiguous matches and unnamed creates remain unknown.
Another explicit Create is still available; Retry never sends a duplicate POST.

Exact-name destructive confirmation protects deletion of the bucket and all objects.
Context changes abort requests, discard late responses, clear all selections,
forms, failures, notices and presigned output, close confirmation and focus the
page heading. These are the approved parity differences from legacy.

## Kit composition

Use explicit data and label props. Compose the resource-index/page-toolbar pattern
from Page, PageHeader, Toolbar and DataTable because the template includes client
filters/paging and PageToolbar always adds a search box. Compose the documented
file-upload-panel pattern from Field and Input to preserve the explicit Upload
activation: the block auto-uploads on file selection. Compose confirm-destructive
from AlertDialog for translated typed-name prompts and local error surfaces.
No new component, dependency, color or token override is introduced.

## Validation and delivery boundary

Vitest covers request parity, states, destructive confirmation, create reconciliation,
401/retry counts, routing/rollback and stale-context responses. The mocked browser
journey covers es/en at 375, 768 and 1280 pixels, axe, request audit, runtime health,
CSP and masked screenshots. Chromium is unavailable in the maker sandbox; PR CI
runs browser parity, axe, CSP and viewport checks. The checker and operator assess
visual baselines. MCP is absent; the supplied Hermes kit snapshot and installed
pinned kit are the offline references, and validate_page is NOT_RUN.

R3: deletion is irreversible and authenticated mutation replay can duplicate an
already-applied write. This source change grants no approval, merge or deployment
authority. Backend, legacy, shared session/API code, existing tests, deployment,
credentials and dependency lockfiles remain outside scope.

## Rollback

Remove `migrated: true` from the storage route. The next URL renders pendingPage
without storage requests and navigation hands off to legacy. Rollback cannot
restore deleted buckets or objects.
