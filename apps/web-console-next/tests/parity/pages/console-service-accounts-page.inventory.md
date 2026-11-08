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

Twelve report cells: the roles `tenant_owner` and `tenant_viewer`, each in es and en at 375, 768 and 1280 px, with
the eight checks in every cell. The owner cells carry the write journeys; the viewer cells assert the read-only
notice (role label and reason from this page's catalog), every write control disabled with its reason, no request
sent, the list states, axe, responsive, runtime health, the read-only capture and the colour lint. Tracing is off for
the whole file because the disclosure journeys show synthetic secrets; screenshots mask them, and variants are reset
before every capture.

Every owner cell compares both builds: `console-service-accounts-page.legacy.mjs` serves the legacy bundle (an existing
`apps/web-console/dist`, or `LEGACY_CONSOLE_DIST`, or a one-off build) with the same session, clock, viewport and
mocked backend, and the create, reveal, rotate, revoke and delete journeys must send the same requests, refetch the
same number of times and disclose the same credential id and secret. The legacy page is Spanish only, so its controls
are located with the Spanish copy in every cell. Write counts are per-scenario deltas because the harness keeps
requests across `parity.open` calls.

Context switches (tenant and workspace) run with a confirmation, a disclosure and a failure open. The open modal makes
the shell's workspace menu inert to pointer input, so for the two modal cases the spec replays the pointer events
on the menu trigger and item as DOM events; Vitest covers the same switches with the real shell context.

The primary Revocar and Eliminar buttons read the list first after a network failure, like Reintentar. Escape
dismisses a mapped create or Revelar alert (409, 429) from the control that regains focus.
The Spanish locale check allows the legacy client-state labels `Enabled` and `Disabled`, for this page only.
