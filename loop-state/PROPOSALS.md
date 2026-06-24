# Feature Proposals (design PRs — spec only)

Each row: a `/propose-feature` run that produced a validated OpenSpec change + a spec-only design PR (never merged to main; implementation is a separate step).

| change-id | branch | PR | issue | critic | status |
|---|---|---|---|---|---|
| `add-console-secrets-management` | `proposal/add-console-secrets-management` | [#722](https://github.com/gntik-ai/falcone/pull/722) | [#723](https://github.com/gntik-ai/falcone/issues/723) | APPROVE (0 blocking) | proposed — awaiting human design review |

## Notes
- **add-console-secrets-management** — Manage workspace secrets in the web console. ADDED `web-console` (7 reqs: the Workspace Secrets screen + `secretsApi` client + gated nav + fail-safe guard + write-only handling + states), MODIFIED `secrets` (converge the kind runtime with the published contract: POST create-only/`409`, PUT replace, advertised metadata, value strictly write-only). Pipeline: spec-analyst → spec-architect → spec-author → independent spec-critic (2 blockers caught + fixed: the `version` field forbidden by the `additionalProperties:false` schema; the missing POST-409-on-duplicate). Supporting analysis/design under `loop-state/proposals/add-console-secrets-management/`. Implementation can be picked up from issue #723 via the fix/feature loop.
