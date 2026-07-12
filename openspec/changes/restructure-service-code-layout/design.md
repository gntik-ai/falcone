# Design — restructure-service-code-layout

## Goals
- Make the release-deployed product service roots discoverable by path.
- Keep all release image identities and chart values stable.
- Separate shared/action code from deployable apps without changing behavior.
- Provide a machine-readable service catalog that validators and docs can use.

## Target Layout
- `apps/control-plane` contains the release control-plane runtime previously rooted under
  `deploy/kind/control-plane`.
- `apps/control-plane-executor` contains the executor/data-plane runtime previously rooted under
  `apps/control-plane`.
- `apps/web-console` remains the React/Vite SPA source and now also owns the release Dockerfile and
  Node static-server release runtime.
- `apps/fn-runtime`, `apps/workflow-worker` and `apps/mcp-runtime` contain the remaining release
  service sources and release Dockerfiles.
- `packages/<name>` contains shared/action/library code consumed by apps.
- `deploy/gateway-config` and `deploy/keycloak-config` contain deploy configuration, not product
  service source.
- `tools/falcone-cli` contains the developer CLI.
- `apps/console` is retained as legacy non-deployable source and is not cataloged as a release
  service.

## Catalog Contract
`service-catalog.json` is the source-level catalog for issue #900. The service-catalog validator
reconciles it with `.github/workflows/release-images.yml` and asserts:
- exactly the six release image matrix entries are cataloged as release services;
- each release service source is under `apps/<service>`;
- each release Dockerfile is co-located under the service source root;
- chart alias/value key metadata is present without changing published image names;
- direct dependencies and inter-service calls are recorded;
- non-release candidates are explicitly marked as `release: false` evidence.

## Compatibility
The change is a repository layout move. Release image names, chart aliases, chart value keys,
runtime entrypoints and public API behavior are intentionally preserved. The sibling charts
repository does not need edits for this change.
