# console-workspace-secrets-page parity inventory

Route `/console/workspace-secrets`, legacy `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx`. Every request goes through `requestConsoleSessionJson` with the legacy method, path and payload; the only addition is the `page[after]` cursor (`functions.openapi.json:136-158`). `GET .../secrets/{name}` is never sent.

| Action | Request | Legacy | New |
| --- | --- | --- | --- |
| List (first page) | `GET /v1/functions/workspaces/{ws}/secrets` | `secretsApi.ts:60` | `consoleWorkspaceSecrets/api.ts` `listSecrets` |
| Load more | `GET .../secrets?page[after]={cursor}` | not in legacy | `listSecrets(id, cursor)` |
| Create | `POST .../secrets` `{secretName, secretValue, description?}` | `secretsApi.ts:69` | `createSecret` |
| Replace | `PUT .../secrets/{name}` `{secretValue, description?}` | `secretsApi.ts:86` | `updateSecret` |
| Delete | `DELETE .../secrets/{name}` | `secretsApi.ts:102` | `deleteSecret` |

Fixtures (all defined in the manifest, ids verbatim from the issue): `shell.*` (production, live-environment, staging, non-member, no-active-workspace, workspace-switch, workspace-loading, workspace-error) and `workspace-secrets.{list,create,replace,delete,replace-and-delete}.*`.

Secret values: the route handler in `console-workspace-secrets-page.support.mjs` compares `secretValue` with the synthetic canary in memory and logs only the fixed mask. The spec disables traces, screenshots and video, sets `PLAYWRIGHT_NO_COPY_PROMPT=1`, types values through `locator.evaluate` and asserts clearing as a boolean. `verify-artifacts.mjs` runs a failing probe with failed, retried and aborted POST and PUT writes and scans every persisted artifact on disk.
