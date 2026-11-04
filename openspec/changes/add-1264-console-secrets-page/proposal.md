# Migrate the console secrets inventory

## Why

Issue #1264 revision 4 migrates `/console/secrets` from the legacy console to
`apps/web-console-next`. The legacy page has a static inventory and an unhandled
revoke rejection. Live inventory requires binding revocation to the target the
server derives from the authenticated token, because inventory can span tenants.

Approved blueprint: `57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Page: `console-secrets-page`, wave `u2`, entry SHA256
`078052df8e17519bf123073e8ab47288297d96d0104a20c11fd6c4a304d94fec`.

## What changes

- Enable the existing secrets migration flag and lazy page dispatch, without a
  route guard, role gating or navigation entry.
- Compose the resource-index layout using the pinned gntik-ui 0.11.0 kit,
  explicit props, kit tokens and the `pages.console-secrets-page` es/en catalogs.
  Use AlertDialog for typed confirmation with extra fields and failure content.
- Read one platform and one tenant inventory on load. Scope the tenant request
  only to the session's sole `principal.tenantIds` entry. Display returned rows
  without pagination or totals and explain that inventory may be incomplete.
- Disable revoke for null versions and targets that do not match the server path.
  Re-check binding against the same current session used to obtain the POST token.
- Send exactly `{justification, forceRevoke}` through console-api HTTP primitives.
  A revoke 401 refreshes once and redirects without replaying the irreversible POST.
- Preserve root-relative legacy rotation/history links and all confirmation fields
  on retriable failures. Render complete loading, empty and failure states.
  Restore inventory retry focus to the new retry button or the inventory region.
- Add page, rollback and mocked parity coverage. The shared browser-session
  fixture gains only the two exact inventory GET branches and keeps tenantIds empty.

Revision 4 supersedes the blueprint's static inventory, always-enabled revoke,
`secretPath` request body and 404 route-gap assumptions. The 404 fixture is
`secret-revoke-404-not-found` throughout, including visual-review coverage.
The later legacy path/name validation and removal of `secretPath` from revoke
payloads remain preserved.

## Validation

Vitest covers requests, binding, states, retry focus, exact-name confirmation,
double activation, 401 refresh/no replay and rollback. The mirrored Playwright
journey covers es/en at 375, 768 and 1280 px, request allowlists, axe, runtime
health and visual states. Run normal Vitest, separate shell fixture tests, legacy
and console-api regressions, typecheck, build, i18n/colour lints and parity checks.
Browser parity and CSP run in PR CI because Chromium is unavailable in the maker
sandbox. MCP validation cannot run without a server; use the supplied pinned kit
snapshot and repository checks. Under the November 2 amendment, the checker
reviews visual state coverage in code and fixtures; CI captures screenshots and
the operator reviews baselines after publication.

## Out of scope

Backend or deployment changes, accepting a tenant on revoke, inventory pagination
or totals, the rotation page, legacy changes/deletion, shared contract changes,
new kit components, route guards and navigation changes are excluded.

## Risk and rollback

R3: forced revocation can remove the last valid secret version. Typed confirmation,
strict binding and in-flight protection limit accidental or misdirected requests;
the backend remains the authorization boundary. This source delivery grants no
merge, deployment or approval authority; human approval and both providers remain
required by the delivery gates.

Disable the secrets dispatch and revert its migrated flag to render pendingPage
under `/next/console/secrets` with no inventory requests and hand navigation back
to legacy. Rollback cannot restore already revoked versions.

## Resolved implementation defaults

Mixed inventory failures reject the whole inventory, with other errors taking
precedence over 403, then 404. Inventory 401 follows the shared refresh/replay
policy. Revoke 409/503 retain editable fields and explicit retry. Successful revoke
does not refetch inventory, so displayed rows remain unchanged. Tenant binding
fails closed for zero or multiple tenant IDs, or a token-realm mismatch.
