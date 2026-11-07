# Service accounts parity inventory

Blueprint 57f536f4-a597-4564-9c85-bc835b96e41f (SHA256
d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d), page
`console-service-accounts-page`, entry SHA256
a6254c43da46e4996707c96464e50d9e0233cbc84c8ce670923b020b0e9b2273. ui/blocks/templates
0.11.0, tokens 0.3.0. The gntik_ui MCP server is unavailable in the delivery sandbox, so
`validate_page` is NOT_RUN; the pinned kit snapshot, the colour lint and the repository
checks stand in. Chromium cannot launch there either: every browser run below is left to PR CI.

## Requests and preserved actions

All calls go through `requestConsoleSessionJson`; shared code is unchanged.

| Action | Method and path | Body |
| --- | --- | --- |
| Load, retry, refetch | GET /v1/workspaces/{id}/service-accounts | none |
| Create | POST /v1/workspaces/{id}/service-accounts | displayName, entityType `service_account`, desiredState `active` |
| Revelar | POST .../{serviceAccountId}/credential-issuance | requestedByUserId (session principal, else `unknown-user`) |
| Rotar | POST .../{serviceAccountId}/credential-rotations | reason `Console rotate` |
| Revocar | POST .../{serviceAccountId}/credential-revocations | reason `Console revoke` |
| Eliminar | DELETE .../{serviceAccountId} | none |

Create, issuance and rotation answer 201; revocation, delete and list answer 200. Writes are
idempotent (fresh Idempotency-Key per attempt, including the shared client's single resend after a
401 refresh). No other endpoint is added. Shell bootstrap reads and, in 401 fixtures, the refresh POST are allowed.

## Intended differences

- Rotar and Revocar require the exact account name; legacy rotated at once and revoked behind a plain warning.
- Revelar is masked by default; legacy always showed the secret.
- Success is announced by toast and live announcer; legacy keeps its inline success alert.
- Each mutation fails in its own surface (legacy shared one alert); 403 and 404 are dedicated states.
- After a network failure Reintentar on Revocar or Eliminar reads the list first.
- A context switch moves focus to the heading and discards previous-context responses.
- 401 refresh-ok: the shared client resends once; the page reports the renewed session. The resend carries a
  new Idempotency-Key that the backend does not deduplicate (accepted legacy behaviour).

## Browser journeys (`console-service-accounts-page.spec.mjs`)

Twelve cells: es and en at 375, 768 and 1280 px. Tracing is off for the whole describe because the
disclosure journeys show synthetic secrets; screenshots mask them. The spec compares both builds in the es 1280 cell:
`console-service-accounts-page.legacy.mjs` serves the legacy bundle (an existing `apps/web-console/dist`, or
`LEGACY_CONSOLE_DIST`, or a one-off build) with the same session, clock and mocked backend, and the journeys
create, reveal, rotate, revoke and delete must send the same requests, refetch the same number of times and disclose
the same credential id and secret. Write counts are per-scenario deltas because the harness keeps requests
across `parity.open` calls. Workspace switches with a modal open are covered by Vitest only: the open modal makes the
shell's workspace menu inert, so the browser journey switches tenants through the native tenant select and
the workspace through the menu only with the non-modal failure surface open.
The Spanish locale check allows the legacy client-state labels `Enabled` and `Disabled`, for this page only.
