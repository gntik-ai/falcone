# Design

## Context

`/console/auth` already calls the public workspace external-application and
federation provider API paths, and the public OpenAPI/route catalog already
advertise those paths. The kind control-plane runtime did not register local
handlers for the paths, so tenant owners saw `404 NO_ROUTE` from actionable UI
controls.

## Approach

Implement the already-published routes in the kind control-plane runtime rather
than hiding the web-console section. The handlers are local to the kind
control-plane and use the existing runtime conventions:

- resolve the workspace from the path;
- fail closed for non-platform identities with no verified tenant scope;
- hide foreign or missing workspaces as `404 WORKSPACE_NOT_FOUND`;
- allow reads to same-tenant callers and platform callers;
- require tenant owner/admin or platform identity for mutations;
- validate external-application and federated-provider payloads before any
  write;
- return the existing public collection and mutation envelopes.

The external-application records are stored in a local `external_applications`
table keyed by tenant, workspace, and application id. Federation providers are
stored inside the application document because the public provider routes are a
subresource of an external application and no separate runtime provisioning
service exists in kind for these routes.

## Wire Compatibility

No OpenAPI, generated SDK, or web-console request path change is required. The
fix implements paths that were already advertised and already used by
`ConsoleAuthPage`.

Runtime responses are shaped to match the existing public schemas:

- collections return only `items` and `page`;
- `page.size` is always in the published `1..200` range;
- absent cursors are omitted rather than returned as `null`;
- OIDC `iamClient` responses include the required `realm`, `clientId`,
  `clientType`, and `defaultClientScopes` fields when present.

## Deployment Packaging

The kind control-plane image copies the new application handler and all flat
local modules imported by the copied runtime handler graph. A Dockerfile
black-box test validates that copied local imports are also copied, preventing
the control-plane image from starting with a missing module.

## Verification

Live deployment was not performed in this run because the active Kubernetes
context is `default`, not a designated local `kind-*` test context, namespace is
unset, and no local kind clusters are available. Verification is therefore
limited to local handler, route, contract, Dockerfile packaging, OpenSpec, unit,
and web-console regression checks.
