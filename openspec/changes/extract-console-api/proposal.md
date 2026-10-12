## Why

Issue #1072, approved request `7006d96b-708c-58be-91c2-2bec5a273d69` revision 2,
requires the u0 console API foundation. Transport, authentication, session refresh and shell
loaders currently depend on the legacy app's `@/` alias. Later console migrations need the same
API layer without importing React or app code.

## What Changes

- Add private `@in-falcone/console-api`, consumed as TypeScript source through per-module
  exports: http, session, auth, config, permissions, workspace-secrets-access, loaders, clients
  and fixtures. Internal imports remain relative and the core has no React dependency.
- Move the six existing API/session/config/permission modules with only import changes.
  Preserve the full auth surface, storage representation, keys, invalidation event, headers
  and refresh behavior. Keep the React provider in the app and extract its two shell loaders.
- Provide typed clients for the existing seven auth endpoints and the three shell paths,
  plus synthetic response fixture builders and a recursive fixture validator in the tests.
- Rewrite app imports and mocks to package subpaths and require the package Vitest suite in
  the existing web-console CI job. Preserve the app's Vitest settings and existing test cases.
- Rename the separate private secret-rotation request helper so the required source scan finds
  no app definition of `requestJson`; its request behavior is unchanged.

## Non-Goals

Routed-page clients are deferred to u1-u4 or an inventory-backed follow-up: blueprint
`57f536f4-a597-4564-9c85-bc835b96e41f` (SHA256
`d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d`) has no endpoint
inventory in this snapshot. No clients are added under the four blocking gaps. This change
adds no new app or route and changes no Helm, APISIX, CSP, static server, Dockerfile,
workflow chart pin, runtime dependency, or baseline TypeScript build behavior.

## Exit Criteria

The console-api spec delta defines compatibility, HTTP, refresh, loader, client-set and fixture
contracts. The package and app suites pass with unchanged app file/test counts relative to
`7acbac0`; frozen installation, Vite bundling (including VITE_* replacement) and the existing
Docker build pass. A deliberately failing package test fails the web-console CI job.

## Risks and Rollback

Risk is R2: auth/session code and workspace dependency resolution are shared. Preserve storage
compatibility in both directions. Revert the source change to roll back; an operator owns image
publication and deployment. This maker never merges or deploys. Platform dependency resolution
already committed the generated lockfile as `c12679337fda745442c8ca4212565f1fff44f660`.

## Capabilities

### Added Capabilities

- `console-api`: shared source package with legacy session and HTTP compatibility.
