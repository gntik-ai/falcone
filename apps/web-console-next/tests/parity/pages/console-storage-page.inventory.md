# console-storage-page parity inventory

Blueprint `57f536f4-a597-4564-9c85-bc835b96e41f`, page `console-storage-page`,
wave u3; blueprint SHA256 `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Source snapshot `06e774492a072c50d494a75db144330e6af3545a`.

Legacy: `apps/web-console/src/pages/ConsoleStoragePage.tsx`,
`services/dataExportImportApi.ts`, `components/console/ConnectionSnippets.tsx`,
`lib/snippets/snippet-catalog.ts` and `snippet-generator.ts`.
Tests: `ConsoleStoragePage.test.tsx` and storage journey J05 in
`e2e/console-service-e2e.e2e.ts`. Fixtures port the legacy media-assets bucket,
media/hero.png object, custom metadata and quota usage. Only tenant/workspace IDs
are adapted to the existing next-console shell fixtures.

| Action | Method and path | Payload | Legacy reference | New reference |
| --- | --- | --- | --- | --- |
| Buckets and retry/reconciliation | GET /v1/storage/buckets?page[size]=100 | none | ConsoleStoragePage.tsx:326 | consoleStorage/api.ts listBuckets |
| Usage and retry | GET /v1/storage/workspaces/{id}/usage | none | ConsoleStoragePage.tsx:339 | api.ts getUsage |
| Objects and append/retry | GET /v1/storage/buckets/{id}/objects?page[size]=50&page[after]? | none | ConsoleStoragePage.tsx:351 | api.ts listObjects |
| Metadata and retry | GET /v1/storage/buckets/{id}/objects/{key}/metadata | none | ConsoleStoragePage.tsx:379 | api.ts getMetadata |
| Presign and retry | POST /v1/storage/buckets/{id}/objects/{key}/presign | operation download, ttlSeconds 300 | ConsoleStoragePage.tsx:390 | api.ts presign |
| Create | POST /v1/storage/workspaces/{id}/buckets | trimmed optional name or empty object | dataExportImportApi.ts:69 | api.ts createBucket |
| Upload and retry | PUT /v1/storage/buckets/{id}/objects/{key} | content, contentType, encoding base64 | dataExportImportApi.ts:94 | api.ts uploadObject |
| Export and retry | POST /v1/storage/workspaces/{id}/buckets/{id}/exports | empty object | dataExportImportApi.ts:113 | api.ts exportBucket |
| Delete and retry | DELETE /v1/storage/buckets/{id} | none | ConsoleStoragePage.tsx:434 | api.ts deleteBucket |

All requests go through `@in-falcone/console-api/session`. No export GET, import,
tenant export or clone request is sent. Shell bootstrap and refresh requests use
the unmodified harness. Successful create/delete refresh buckets and usage;
successful upload reloads the first objects page. The unchanged CSP sweep visits
every concrete route, including storage. Its empty tenant bootstrap needs no
browser-session registry additions.

The manifest enumerates fixture families for delayed sections, empty collections,
no timestamps/custom metadata/breakdown, unavailable/stale/no-quota usage, read and
mutation failures, retries, clipboard states, missing tenant/workspace and context
switches. Unit tests exercise the full 401 matrix and retry outcomes, the strict
create matrix and late responses after tenant and workspace switches. The browser
journey mirrors inspection, pagination and failures from J05, adds all mutations,
clipboard/download assertions, localized chrome, axe, runtime diagnostics and
responsive checks in es/en at 375, 768 and 1280 pixels.

## Approved parity qualifications

Revision 3 retains the legacy shared-session single authenticated replay after a
401. Count limits mean one activation plus one successful-refresh replay. A create
network retry reconciles by GET only, with exact name, new ID, active workspace and
complete inventory required; inconclusive outcomes never send another POST.

Approved differences: context changes close delete confirmation, clear presigned
results, focus the heading, abort reads and guard late mutation/retry completions.
The kit composition replaces legacy inline width, palette colors and emerald
notices with tokens. It does not change API requests or backend authorization.

## Artifact and review boundary

Automatic browser traces, failure screenshots and video are off. Explicit captures
mask `storage-presigned-result`; request logs never include returned URLs or auth
headers. Clipboard assertions compare the exact client-generated snippet. Browser
parity, axe, CSP and viewport runs are SKIPPED in the maker sandbox because Chromium
is unavailable; PR CI runs them. The independent checker and operator assess the
masked es/en captures and approve visual baselines. validate_page is NOT_RUN because
no MCP server was supplied; the Hermes snapshot is the pinned offline reference.

## CI parity repair

The delayed-section assertions match the pinned kit's status content instead of
requiring an accessible name that TableSkeleton does not supply. They retain the
visible loading-label check and also require `aria-busy=true`.
Tenant-switch scenarios dispatch the native select's change event, including while
the delete dialog holds focus; workspace scenarios retain the kit menu interaction.
Both keep the late-response, cleared-surface, heading-focus and request-count checks
at every locale and viewport. No product behavior or existing foundation test changes.
