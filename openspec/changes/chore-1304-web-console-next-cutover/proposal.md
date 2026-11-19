# chore-1304: cut over the in-falcone-web-console image to web-console-next at /

## Problem

The `in-falcone-web-console` image still serves the legacy `apps/web-console` bundle at `/` and
`apps/web-console-next` under `/next` (`apps/web-console/static-server.mjs`,
`apps/web-console/nginx.conf`). Blueprint 57f536f4 item `cutover:u5-cutover` ends the migration:
next is served at `/` with SPA fallback, `/next` is redirected permanently, and no legacy bundle is in
the image. The operator approved the cutover on 2026-11-18. All 57 Blocked-by items (50 `page:*`,
7 `gap:*`) are recorded CLOSED with merged PRs (evidence sha256 `ac4ff6f5…dd23`). The nginx config has
no `/healthz` location, so `/healthz` falls through to the SPA. No release gate and no rollback
evidence exist yet.

## Scope (switch release)

- `static-server.mjs` serves only the next dist at `/` with SPA fallback; `/next` and `/next/*` answer
  `301` with a relative `Location` built from the raw request target; `/legacy` and `/legacy/*` answer
  404. `/healthz`, the `/v1` proxy, the CSP and the security headers are unchanged.
- `apps/web-console/nginx.conf` and `deploy/kind/web-console/nginx.conf`: the `/next` serving blocks are
  replaced by one redirect location (`absolute_redirect off`, target from `$request_uri`, security
  headers on that location only), a traversal guard, a `/legacy` refusal and `location = /healthz`
  before `location /`.
- Build: `apps/web-console/Dockerfile`, `deploy/kind/web-console/Dockerfile`, `.dockerignore`,
  `release-images.yml` and `ci.yml` build next at base `/` and copy only the next dist. An image
  contract script (`scripts/release/verify-web-console-image.sh`) checks UID 1000, only the next dist,
  no token, the release version and source commit in the served bundle, and a read-only root.
- Gate: `scripts/release/cutover-gate.mjs` with `release-evidence/cutover-gate.json` (generated from the
  Blocked-by list and the recorded closure evidence) and a CI job. Offline it requires the evidence to
  cover exactly the Blocked-by items; with `--api` (CI) it re-checks every entry against the GitHub API
  and fails closed on any error.
- Rollback evidence: `release-evidence/web-console-rollback.json` records the prior tag `sha-ca5183d`
  and digest `sha256:77e614f1a084b2ada754bccfab37c6018ffed5302078e87c89c055dd8c80dd5a`.
- G1/G2: `assertNoSampleData` (tests/parity/checks.mjs) runs on every settled state of a parity journey
  through a harness guard, against `kit-sample-strings.json`; the static rule
  `parity/no-implicit-sample-data` in `tests/parity/validate.mjs` rejects a kit `DataTable` whose `rows`
  is not provably supplied.
- Tests updated: shell specs and CI structure tests follow the root base path.
- Deployment (falcone-charts): a chart contract test shows that a digest-pinned `webConsole.image`
  renders `repository@sha256:…` and that a tag-only value still renders. The `webConsole` key and
  values are unchanged.

## Out of scope

- Deleting `apps/web-console`, the dead modules and orphan pages, and moving the serving config. This is
  the following release and needs its own ChangeSet; the legacy source stays in this release.
- Page migration, parity or i18n fixes, backend or gateway route changes, CSP, image name, chart key,
  console-api session format or kit pins.
- Inventing or committing the switch-release digest, changing the staging Argo CD ImageUpdater, deploying
  or running the rollback rehearsal. These are operator tasks.

## Recovery

There is no runtime flag, path or environment switch that serves the legacy console. Recovery is only
by redeploying the prior chart and the recorded digest through the deterministic Helm adapter; the
shared console-api session format keeps existing sessions valid.

## Risks

- The console is replaced for every tenant at once; the only mitigation is the gate plus the prior digest.
- A mistake in the nginx `/healthz` location breaks readiness for nginx-based deployments: covered by
  request tests (CI runs them against a real nginx) and by the kind config.
- Mishandling the raw request target could cause an open redirect or path confusion: the redirect is
  relative, built from the raw target, refuses a second slash or backslash after the prefix, and runs
  after the traversal check.
- The chart pins by tag while rollback depends on the recorded digest; the operator records the
  switch-release digest after `release-images` publishes it.

## Open questions

- Redirect code: `301` as specified, or `308` to preserve non-GET methods.
- Deletion-release destination of the serving config: `apps/web-console-next` (service-catalog.mjs:335-341)
  or shared deploy tooling (relaxing :362).
- Whether `lint:snippets` and `validate-structure.mjs:17-18` are repointed or retired (deletion release).
