# Auth config migration evidence

Page: `console-auth-config-page` (route `/console/auth-config`), issue #1259, risk R3, wave u2.
Blueprint SHA256: `d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`.
Approved entry SHA256: `7fbfc240385a7d6dcb8b8e80454573762584b5f05cf49852f032783d7999e2c6`.
Delivery base: `90a59a9a1911b7dc7ec3bfc8b6321d2502bf6343`.
Kit: the supplied Hermes snapshot `b7d8a4becbeb1789bf9f529e583580f622feafa4a78ad9767874523c8fdc1a22`, packages pinned to 0.11.0 and tokens 0.3.0. No MCP server is configured, so `validate_page` is NOT_RUN; the Falcone colour lint and the kit type definitions stand in for it.

## Requests

Four calls, all through `requestConsoleSessionJson` (bearer, one 401 refresh and replay, `Idempotency-Key` on mutations), in `packages/console-api/src/auth-config.ts`, exported as `@in-falcone/console-api/auth-config`:

| Action | Method and path | Body |
| --- | --- | --- |
| Load, Recargar, reload after delete | `GET /v1/tenants/{tenantId}/auth-config` | none |
| Guardar cambios | `PUT /v1/tenants/{tenantId}/auth-config` | only the changed login-method booleans |
| Crear, Editar, Habilitar or Deshabilitar | `PUT /v1/tenants/{tenantId}/auth-config/identity-providers/{alias}` | `{providerId, displayName, enabled, config {clientId, defaultScope, clientSecret?}}`, or `{providerId, enabled}` for a toggle |
| Eliminar | `DELETE /v1/tenants/{tenantId}/auth-config/identity-providers/{alias}` | none |

The client is a new entry rather than an addition to `clients.ts` because `packages/console-api/tests/cases/clients.mjs` pins the exact export list of `clients`, and the ChangeSet edits no existing test. Method, path and payload shapes are field-for-field those of `apps/web-console/src/services/authConfigApi.ts:59-107`; `packages/console-api/tests/auth-config.test.ts` pins them.

## Legacy delta since the blueprint

`fecb3a03..90a59a9a` only moved imports to `@in-falcone/console-api` (HTTP types, session, permissions and context loaders). No behaviour, API call, validation, state or copy of this page changed, so nothing further was carried over.

## Secret handling

The client secret lives only in the uncontrolled password input of the provider dialog. It is read once on submit, the input is emptied before the request leaves, and it is never put in React state, storage, logs, toasts or announcements. After a failed save the secret input is empty and the other fields are kept. The leak assertions in `tests/consoleAuthConfig.test.tsx` and in the `action`, `error-empty` and `runtime-health` parity checks look for the synthetic value in the DOM, storage, console output and every request other than the create body.

## Intended differences

- The delete confirmation composes the kit alert dialog with catalog copy instead of the `confirm-destructive` block: that block hard-codes English type-to-confirm text (`gap-kit-builtin-copy-english`) and would require typing the name, which the legacy WARNING-level confirmation did not. It names the provider, states the legacy impact text, stays open with its error on failure, sends nothing on cancel and returns focus to its trigger.
- `sticky-action-bar` always renders Descartar cambios; the kit disables it while the form is clean or saving instead of hiding it. The unsaved-changes text and its status dot still change with the dirty state.
- Recargar lives in the page header (spec) instead of the methods card. The kit header renders its actions in a wide and a narrow layout; CSS hides one.
- The result (saved, provider updated, deleted, URL copied) appears in a focusable region, a toast and a polite announcement. Failures are announced assertively.
- The provider list is a `data-table`; the toolbar with Crear proveedor shows when at least one provider exists, and the first-run empty state carries the single Crear proveedor otherwise.
- A read 404 renders a not-found state with a link to `/console/overview`; a 500 shows the status, the request id and Reintentar.

## Verification

Vitest: `tests/consoleAuthConfig.test.tsx` (rendering in es and en, loading, save body, discard, reload, save failures, read 403/404/500/network, permissions by role, empty states, create with the leak scan, validations, duplicate alias, edit without a secret, dialog failure, focus return, toggle and its failures, copy, delete cancel and confirm, delete failure, tenant switch) and `tests/consoleAuthConfig-routing.test.tsx` (route flag, no role guard, 401 refresh-ok and rejected under the `/next` basename, in-router link and `navigate()`). `packages/console-api/tests/auth-config.test.ts` pins the four requests.

Browser parity, axe, viewport (375/768/1280) and the CSP sweep are SKIPPED here: Chromium is unavailable in the maker sandbox and PR CI runs them. The visual spec covers loaded, dirty, read-only, empty, no-access and error in es and en and attaches SHA256-named screenshots; PR CI captures the baselines and operator approval gates the merge.

Kill switch: remove `migrated: true` from the `auth-config` entry in `src/shell/routes.ts`.
