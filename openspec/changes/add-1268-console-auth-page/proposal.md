# Migrate the console Auth/IAM page

## Why

Issue #1268 migrates `/console/auth` (wave u2) from the legacy SPA to the next
console on the pinned gntik-ui kit. The approved blueprint is
`57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`; page
`console-auth-page`, entry SHA256
`08dd6f5d202c850561a3d8f684830ff9702fa8f8ec1a551e701ba14f2a6700c3`.
The page creates real Keycloak clients (a confidential one answers with a secret)
and edits federated identity providers, so it is risk R3.

## What changes

- Add the lazy page `src/pages/consoleAuth.tsx` with its `consoleAuth/` folder and the
  `pages.console-auth-page` namespace (es default, en). `auth` is flagged migrated in
  `src/shell/routes.ts` and dispatched in `src/router.tsx` behind `<Guard kind="superadmin">`.
  Clearing the flag restores the pending page.
- Keep the legacy requests with their method, path, query and payload shape, through the
  shared session client: four realm reads with `page[size]=100`, the applications read with
  `limit=100`, application POST (idempotent) and PUT, provider POST (idempotent) and PUT,
  and the wizard `POST /v1/workspaces/{ws}/iam/clients` (idempotent, `wiz` request id).
  The page sends no `/v1/metrics/*` request.
- Reload rule: a successful application or provider create, update, soft delete, toggle or
  detach is followed by exactly one applications read. Wizard steps, the wizard submit, retries,
  client selection, navigation and failed mutations send none. The applications Reintentar sends
  only its own read.
- Compose resource-index from page-header, kpi-row, section-header, data-table, page-toolbar,
  form-section, validation-summary, sticky-action-bar, description-list-card, inline-callout,
  error-panel and the empty-state variants. The IAM client wizard is a focus-mode overlay
  (`WizardLayout`) with a stepper and a description-list-card review.
- Section failures: 403 shows the localized no-access text and never the backend message; 404 shows
  not-found with a link back; other failures show error-panel with the status, the request id and
  Reintentar. Realm sections offer Reintentar only for retryable errors (network, 408, 429, 5xx) and
  otherwise say that reloading will not help. Applications always offer it.
- The wizard never reads the response body beyond `iamClientId`: a `clientSecret` is not stored,
  rendered, announced or logged. A failed submit shows error-panel with Reintentar in the review
  step and keeps every value.
- Without the `iam.clients.manage` permission (re-read from the persisted session when the wizard
  opens) the wizard shows the blocked state with the deny reason and no stepper.
- Update the `auth` superadmin expectation in `tests/shell.test.tsx` to the page heading.

## Out of scope

Backend, control-plane route and contract changes (including the IAM client-create route),
showing or storing a confidential client secret, new kit components, the shell context and metrics
requests, editing or deleting the legacy page, and any change in gntik-ai/falcone-charts.

## Risks

- A leaked client secret exposes a credential. The wizard keeps only `iamClientId`; the test suite
  asserts the secret is absent from the DOM, toasts, announcer, console, local and session storage.
- Federated provider edits change how users sign in; a wrong payload breaks login. The payload
  builders are ported verbatim from the legacy page.
- A repeated wizard submit after a failure sends a new idempotency key, as legacy does, so a
  server that applied the first request could create a duplicate client.
- A revert does not undo clients, applications or providers already changed through the page.

## Rollout and kill switch

The page ships beside the legacy console, which keeps serving `/console/auth` until the u5
cutover. Removing `migrated` from the `auth` route (or reverting the commit) restores the pending
page. No backend or chart rollback is involved.

## Open questions

- Should a wizard retry after a 500 reuse the first idempotency key while the values are unchanged?
  Legacy (and this page) issues a new key per submit.
- Should a successful wizard submit reload the realm clients table? Legacy does not (`:749`); neither does this page.
- Are gap-b001 and the u0 epics closed now that the IAM client-create route exists?
