# functions — spec delta for add-function-caller-context

## ADDED Requirements

### Requirement: Functions receive a verified, tamper-proof caller context

The system SHALL provide an invoked function with a read-only caller context containing
`tenantId`, `workspaceId`, `principal`, `actorType`, and `roles`, derived from the verified
caller identity resolved by the control-plane JWT middleware, delivered out-of-band from the
user-controlled invocation payload, so that the function can scope behavior to its caller and
cannot forge that identity.

The caller context SHALL be injected as `X-Falcone-Tenant-Id`, `X-Falcone-Workspace-Id`,
`X-Falcone-Principal`, `X-Falcone-Actor-Type`, and `X-Falcone-Roles` HTTP headers by the
control-plane executor (`deploy/kind/control-plane/function-executor.mjs::invokeKnative`)
over the cluster-internal path to the Knative service. The fn-runtime
(`deploy/kind/fn-runtime/server.mjs`) SHALL read the context exclusively from these request
headers (never from the parsed `params` body) and expose it to user code as the second
argument of the function's `main(params, context)` call.

`workspaceId` in the context SHALL be sourced from the resolved function row
(`r.workspace_id`), falling back to `ctx.identity.workspaceId`, so it reflects the resource
being invoked rather than the caller's ambient workspace identity. All other fields
(`tenantId`, `principal` = `ctx.identity.sub`, `actorType`, `roles`) SHALL be sourced from
the verified `ctx.identity` and SHALL NOT be overridable by the invocation body.

#### Scenario: function reads caller context

- **WHEN** an authenticated caller invokes a workspace function via
  `POST /v1/functions/workspaces/{wid}/actions/{name}/invocations`
- **THEN** the function's `main(params, context)` receives a `context` object whose
  `tenantId`, `workspaceId`, and `principal` fields match the verified JWT identity of the
  caller, and the invocation response status is `completed`

#### Scenario: caller context is not forgeable via the payload

- **WHEN** the invocation body contains fields named `tenantId`, `workspaceId`, `principal`,
  `actorType`, or `roles` that differ from the values in the verified JWT
- **THEN** the `context` argument the function receives reflects the VERIFIED caller identity
  from `ctx.identity` and the resolved function row, not the body-supplied values; the
  body-supplied fields appear only in `params`, not in `context`

#### Scenario: backward compatibility with single-argument functions

- **WHEN** a deployed function defines only `main(params)` (no second argument)
- **THEN** the invocation still succeeds, `status` is `completed`, and the result is
  returned normally; the additional `context` argument is silently ignored by the runtime
