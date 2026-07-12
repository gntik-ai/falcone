# Restructure service code into a clearer layout

## Why
The current repository layout makes it hard to see which services exist, what language each is written
in, and what each depends on. New contributors cannot quickly answer "what are the services and how do
they relate?". A predictable per-service structure with a service catalog, plus light refactoring to
standardize each service, makes the codebase legible without changing behavior.

## What Changes
- Reorganize the six release-deployed services under `apps/<service>` with each release Dockerfile
  co-located: `control-plane`, `control-plane-executor`, `web-console`, `fn-runtime`,
  `workflow-worker` and `mcp-runtime`.
- Keep the six published image names and their chart aliases/value keys unchanged; no sibling chart
  change is required.
- Move shared/action/library code under `packages/<name>` and deploy config roots under `deploy/`,
  without adding release images or changing runtime behavior.
- Add a top-level `service-catalog.json` listing every release-deployed service's language, image
  identity, chart alias/value key, source, Dockerfile, direct dependencies and inter-service calls.
  Explicitly mark incomplete/non-release candidates as evidence only.
- Light refactor permitted: standardize per-service layout, co-locate build files, extract obvious
  shared modules — but no functional change.
- Update monorepo configuration (pnpm workspaces, Turbo pipeline) and CI paths.
- Guard the layout with repository/service-catalog validation and focused automated tests, alongside
  feasible local unit/contract/build checks.

## Impact
- Affected specs: `repository-structure` (new).
- Broad file moves and import-path churn; **no behavior change**.
- CI path filters and caching keys change.
- Local Kubernetes deployment verification is not part of this change because the designated kind
  cluster is unavailable in the maker environment; the change remains chart-compatible by preserving
  chart aliases/value keys and not requiring sibling chart edits.
