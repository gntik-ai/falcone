# Serve web-console-next at the root and redirect /next (UI u5 switch release)

## Why

UI migration blueprint 57f536f4 (item `cutover:u5-cutover`) ends with the next console replacing the
legacy one. Today the `in-falcone-web-console` image serves legacy at `/` and next under `/next`
(`apps/web-console-next/static-server.mjs`, `apps/web-console-next/nginx.conf`). Issue #1304 is the switch
release, risk R3: every tenant's default console changes at once. Deleting the legacy source is a
separate, later change set; the legacy source stays for one release and nothing serves it.

## What changes

- `static-server.mjs` serves only the next bundle, built at base `/`, with SPA fallback; a missing
  `/assets/*` is 404; `/legacy` is 404. `/next` and `/next/*` answer a relative `301` built by one
  function, `validateRedirectPath`, from the raw request target (suffix and query byte for byte,
  `/%6Eext` normalised); `//`, backslash and `..` forms answer 400.
- `apps/web-console-next/nginx.conf` and `deploy/kind/web-console/nginx.conf` classify the raw
  `$request_uri` in a `map`, answer from one named location with the security headers and
  `absolute_redirect off`, add no server-level header, and answer `location = /healthz` with
  `200 ok` before the SPA fallback.
- The Dockerfile builds only next at `/` and copies only its dist to `/app/dist`; the kind
  Dockerfile copies it too; `.dockerignore` re-includes `apps/web-console-next/dist`;
  `release-images.yml` and `ci.yml` build and verify one bundle at `/`.
- Fail-closed cutover gate `scripts/release/cutover-gate.mjs` with committed evidence
  `release-evidence/cutover-gate.json` (57 blocking items), and the CI job `cutover-gate`.
- `release-evidence/web-console-rollback.json` records the prior tag `sha-ca5183d` and digest
  `sha256:77e614f1a084b2ada754bccfab37c6018ffed5302078e87c89c055dd8c80dd5a`.
- Kit sample-data guards: `tests/parity/kit-sample-strings.json` extracted from the pinned kit by
  `scripts/extract-kit-sample-strings.mjs`, `assertNoSampleData` on every settled state of the
  parity harness, and the allowlist rule `parity/no-implicit-sample-data` in `parity:validate`.
- falcone-charts: a contract test that a digest-pinned `webConsole.image` renders
  `repository@sha256:...` and a tag-only value still renders `repository:tag`.

## Boundaries and rollback

No CSP, image name, chart key `webConsole`, session format or kit pin changes. No page migration,
no deployment and no invented switch-release digest: that digest exists only after `release-images`
builds the merged cutover commit, and the operator records it during the staging rollback
rehearsal. There is no legacy routing. Roll back by redeploying the prior chart with the recorded
digest through the deterministic Helm adapter; the console-api session format is shared, so
existing sessions stay valid.
