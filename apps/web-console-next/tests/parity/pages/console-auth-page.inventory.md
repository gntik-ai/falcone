# Auth/IAM page parity inventory

Blueprint SHA256 d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d;
approved entry 08dd6f5d202c850561a3d8f684830ff9702fa8f8ec1a551e701ba14f2a6700c3.
Kit ui/blocks/templates 0.11.0, tokens 0.3.0. MCP `validate_page` is unavailable in the
delivery sandbox, so the pinned kit types, the colour lint and the repository checks stand in.

## Requests and preserved actions

All calls use console-api `requestConsoleSessionJson`; no shared code changes. The page sends no
`/v1/metrics/*` request.

| Action | Method and path | Query/body |
| --- | --- | --- |
| Load/retry users, roles, scopes, clients | GET /v1/iam/realms/{realm}/{section} | page[size]=100 |
| Load/retry applications | GET /v1/workspaces/{ws}/applications | limit=100 |
| Create application | POST /v1/workspaces/{ws}/applications | buildApplicationPayload; idempotent |
| Edit application | PUT /v1/workspaces/{ws}/applications/{id} | buildApplicationPayload with the existing state, metadata, login, logout, providers |
| Soft delete | PUT /v1/workspaces/{ws}/applications/{id} | buildApplicationPayload + desiredState soft_deleted |
| Add provider | POST .../applications/{id}/federation/providers | buildProviderPayload; idempotent |
| Edit / toggle provider | PUT .../applications/{id}/federation/providers/{providerId} | buildProviderPayload / provider with enabled flipped |
| Detach provider | PUT /v1/workspaces/{ws}/applications/{id} | application payload with federatedProviders minus the provider |
| IAM client wizard | POST /v1/workspaces/{ws}/iam/clients | clientType, clientId, redirectUris, scopes, permissions []; idempotent; wiz X-Request-Id |

Reload rule (legacy :568, :598, :634, :651, :690): a successful application or provider mutation is
followed by exactly one applications read. Wizard steps, the wizard submit (:749), retries, client
selection, Abrir miembros and failed mutations send none.

## Intended differences

- Kit composition replaces the legacy cards: the application list and the federated provider list are
  data-tables, the forms are form-section groups with validation-summary and sticky-action-bar, and the
  provider panel stays inline (no modal). Soft delete and detach use the kit alert-dialog.
- A section read 403 shows the localized no-access text only (legacy echoed a status message) and 404
  shows a not-found state with a link back. Realm sections keep Reintentar for retryable errors only;
  applications always offer it.
- Mutation messages are localized by status and never echo the backend message (legacy #743 rule extended
  to the wizard, which echoed `apiError.message` for 409, 422 and other statuses).
- The wizard type defaults to Público, the value legacy sent when the select was untouched, so the review
  step shows what is sent.
- The kpi tiles show a loading word instead of a skeleton while their read is in flight.
- The wizard blocked state renders inline with a Cerrar action instead of the legacy page state.

## Not run in the sandbox

Chromium cannot launch there: parity, axe, locale, responsive and CSP browser runs and the visual
baselines run in PR CI. The Abrir miembros link is asserted by its href; following it needs the members
page endpoints, which this page's harness does not register.
