## MODIFIED Requirements

### Requirement: Side-by-side console serving

The single `in-falcone-web-console` image SHALL contain only the web-console-next bundle at
`/app/dist` (built with base `/`) and the static server, run as UID 1000 with a read-only root
filesystem, and carry no registry token. The deployment SHALL retain the `webConsole` key and the image
name. The static server SHALL remain zero-dependency and make no filesystem writes. No runtime flag,
path or environment switch SHALL serve the legacy console.

#### Scenario: Root, auth routes and deep links

- **WHEN** GET targets `/`, `/login`, `/signup`, `/console/tenants` or `/console/flows/abc`
- **THEN** the next `index.html` SHALL return 200 with `Cache-Control: no-store` and the unchanged CSP,
  from both `static-server.mjs` and the nginx config, and `/healthz` SHALL return 200 with body `ok`.

#### Scenario: The former /next prefix

- **WHEN** GET targets `/next`, `/next/`, `/next?x=1`, `/next/a%2Fb`, `/next/a%23b`, `/next/a%3Fb?x=1` or `/%6Eext/a%2Fb`
- **THEN** the response SHALL be `301` with a relative `Location` whose suffix and query are copied byte
  for byte from the raw request target (`/`, `/?x=1`, `/a%2Fb`, `/a%23b`, `/a%3Fb?x=1`, `/a%2Fb`).
- **WHEN** the path contains raw or encoded `..`, or a second slash or backslash follows the prefix
- **THEN** the response SHALL be 400 and no redirect SHALL be sent.
- **WHEN** GET targets `/legacy` or `/legacy/*`
- **THEN** the response SHALL be 404.

#### Scenario: Assets and the API edge

- **WHEN** GET targets `/assets/<hash>.js`
- **THEN** it SHALL return `public, max-age=31536000, immutable`; a missing asset SHALL return 404.
- **WHEN** a request targets `/v1/*`
- **THEN** it SHALL reach the gateway upstream unmodified and without added security headers.

## ADDED Requirements

### Requirement: Fail-closed cutover gate

The release evidence SHALL list exactly the Blocked-by items of the cutover, each closed as completed by a
merged pull request of the recorded repository that references that issue and was merged no later than
the issue closed. `scripts/release/cutover-gate.mjs` SHALL fail when an item is missing or extra, a
closure is `NOT_PLANNED`, a PR is unmerged, references another issue, was merged after the close, or
belongs to another or an unknown repository; with `--api` it SHALL re-check each entry against the
GitHub API and fail on any API error. The gate SHALL also require the prior tag and digest in
`release-evidence/web-console-rollback.json`.

### Requirement: No kit sample data in a page

A parity journey SHALL fail when the page shows a string of `kit-sample-strings.json` at any settled
state: after `open()`, after each guarded action or readiness assertion, and before teardown.
`parity:validate` SHALL fail with `parity/no-implicit-sample-data` for a kit `DataTable` whose `rows` is
not provably supplied, including missing rows, shadowing, reassignment, a later override and an
unresolvable spread. A file that re-exports the kit (named, renamed, `export *` or namespace) or loads
it by dynamic import or `require` SHALL fail too, because a table consumed through a local barrel
cannot be followed.
