# Change: fix-781-auth-console-missing-routes

## Why

Issue #781 is a confirmed console/backend drift. The Auth page at `/console/auth` advertises an
external-applications and federation-provider management section, and the public API catalog already
publishes the corresponding workspace application routes. In the kind control-plane runtime,
however, those routes were not registered, so the console's list and create actions fell through to
`404 NO_ROUTE`.

This made an advertised tenant-owner identity-management capability unusable: opening the section
failed on `GET /v1/workspaces/{workspaceId}/applications?limit=100`, and submitting "Crear
aplicación externa" failed on `POST /v1/workspaces/{workspaceId}/applications`.

## What Changes

- Add a durable kind control-plane `external_applications` registry table keyed by application id,
  workspace, tenant, slug, protocol, and state, with the canonical application document stored as
  JSONB.
- Store federated providers inside `app_json.federatedProviders` for this minimal kind shim.
- Add local handlers for:
  - listing, creating, reading, and updating workspace external applications;
  - listing starter templates;
  - listing, creating, reading, and updating federated providers for an application.
- Register the handlers in the executable route table and both route-map metadata files so the
  runtime and kind image metadata stay in sync.
- Preserve tenant boundaries:
  - read routes resolve the workspace first and allow same-tenant authenticated users or platform
    callers;
  - write routes require tenant owner/admin or platform;
  - missing and foreign workspaces return `404 WORKSPACE_NOT_FOUND` before the application table is
    queried.
- Reuse the existing external-application IAM validation helper for OIDC/SAML application writes so
  invalid configuration returns structured `400 VALIDATION_ERROR`.
- Add focused route/handler regression coverage and architecture documentation.

## Scope

This is an implementation catch-up for already published routes and an already shipped console
section. It does not change the public OpenAPI schema, route catalog, generated SDK, or frontend
request shape.

The kind shim persists the canonical configuration and validates it, but it does not provision real
Keycloak clients or external IdP resources. Those control-plane/data-plane effects remain outside
this issue's minimal fix.

## Capabilities

### Added Capabilities

- `web-console`: `/console/auth` external-application and federation management calls now resolve to
  real workspace-scoped backend handlers in the kind control-plane instead of `404 NO_ROUTE`.
