# Migrate the console service accounts page

## Why

Issue #1263 migrates `/console/service-accounts` (wave u2) from the legacy SPA
to the next console on the pinned gntik-ui kit. The approved blueprint is
`57f536f4-a597-4564-9c85-bc835b96e41f`, SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`; page
`console-service-accounts-page`, entry SHA256
`a6254c43da46e4996707c96464e50d9e0233cbc84c8ce670923b020b0e9b2273`.
The page drives credential reveal, rotation, terminal revocation and permanent
deletion, so it is risk R3.

## What changes

- Add the lazy page module and the `pages.console-service-accounts-page` namespace
  (es default, en) in `apps/web-console-next`, wired like the members route and
  conditioned on `route.migrated`. `service-accounts` is flagged migrated in
  `src/shell/routes.ts`; clearing the flag restores the legacy handoff.
- Keep exactly the six legacy calls with their method, path and payload shape,
  through the shared session client: list, create, credential issuance, rotation,
  revocation and delete. Success statuses stay as the API returns them (create,
  issuance and rotation 201; revocation, delete and list 200).
- Compose resource-index from page-header, inline-callout, section-header, data-table
  (`paginated={false}`), status-tag with a credential statuses map, secret-field and
  code-block disclosures in dialog (DialogBody, DialogFooter, `aria-modal`), and
  typed confirmations composed from alert-dialog (gap-b005-confirm-destructive-extra-fields).
- Rotation gains a typed-name confirmation and revocation moves from a plain warning
  to the same typed confirmation; both are intended differences. Revelar is masked by default.
- Each mutation fails inside its own surface (create form, credential result region
  or the open confirmation): 403 no access, 404 not found, 5xx and network
  `ErrorPanel` with Reintentar and the request ID, other statuses a localized alert.
  Nothing is replayed automatically except the shared client's single post-refresh
  resend; the surface then reports the renewed session.
- After a network failure Reintentar on revoke or delete first reads the list and
  reports an already applied change without a second write.
- A tenant or workspace switch remounts everything bound to the context: open
  confirmations, disclosures, failures, typed names, toasts and in-flight results
  are dropped, and focus lands on the page heading (or the gate heading).
- Parity artefacts under `tests/parity/pages` drive the legacy build and the Next
  build with identical fixtures. `tests/parity/resource-diagnostics.mjs` additionally
  allows the injected 408, 422, 429 and 503 statuses.

## Out of scope

Backend, route-map or contract changes (including success status codes), new kit
components or kit and token bumps, shell and u0 epic work, the shared client resend
and Idempotency-Key generation, changes to or deletion of the legacy page, and any
change in gntik-ai/falcone-charts.

## Risks

- Rotation, revocation and deletion are irreversible; the kill switch does not undo them.
- The shared 401 resend uses a fresh Idempotency-Key that the backend does not
  deduplicate. A backend that applied a write before answering 401 would duplicate it.
- Synthetic secrets could leak through traces, logs or baselines. Tracing is off for the
  disclosure journeys, captures are masked and fixture values are not key-shaped.
- Typed confirmation on Rotar and Revocar changes operator workflow.

## Rollout and kill switch

Build with the flag set, run the parity gate, then serve under `/next/` beside the legacy
page until the u5 cutover. Remove `migrated: true` from `service-accounts` to revert
navigation to the unchanged legacy page. No chart, gateway or Helm change is involved.

## Open questions

- The next nav marks service-accounts `restrictedForAction workspace.write`, so read-only
  roles see it in the restricted group while legacy shows it to all. Accepted parity?
- Whether the u0 blocker epics (shell workspace reload) must land before merge or only
  before the flag is set. The page reloads workspaces through the existing context.
