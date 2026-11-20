## ADDED Requirements

### Requirement: Root console serving

The `in-falcone-web-console` image SHALL contain only the web-console-next bundle, built at base `/`
and served from `/app/dist`, run as UID 1000 with a read-only root filesystem and contain no
registry token. The deployment SHALL retain the `webConsole` key and the image name. No flag,
environment variable or path SHALL serve the legacy bundle.

#### Scenario: Root and deep links

- **WHEN** GET targets `/`, `/login`, `/signup`, `/console/tenants` or `/console/flows/abc`
- **THEN** the next `index.html` SHALL return 200 with `Cache-Control: no-store` and the existing
  CSP and security headers byte for byte, from both `static-server.mjs` and both nginx configs.
- **WHEN** GET targets `/legacy` or `/legacy/*`
- **THEN** it SHALL return 404.

#### Scenario: Assets, traversal and the API edge

- **WHEN** GET targets an existing `/assets/<hash>.js`
- **THEN** it SHALL return 200 with `public, max-age=31536000, immutable`.
- **WHEN** the asset is missing
- **THEN** it SHALL return 404.
- **WHEN** GET targets `/x/../y`
- **THEN** `static-server.mjs` SHALL return 400.
- **WHEN** a request targets `/v1/x`
- **THEN** it SHALL reach the gateway upstream unchanged, without added security headers.

#### Scenario: Health

- **WHEN** GET targets `/healthz`
- **THEN** `static-server.mjs` and both nginx configs SHALL return 200 with the body `ok`, never
  `index.html`.

### Requirement: The /next prefix redirects permanently

`/next` and `/next/*` SHALL answer `301` with a relative `Location` that is the raw suffix and raw
query of the request target without the `/next` prefix.

#### Scenario: Byte-for-byte targets

- **WHEN** GET targets `/next`, `/next?x=1`, `/next/console/tenants?x=1`, `/next/a%2Fb`,
  `/next/a%23b`, `/next/a%3Fb?x=1` or `/%6Eext/a%2Fb`
- **THEN** `Location` SHALL be `/`, `/?x=1`, `/console/tenants?x=1`, `/a%2Fb`, `/a%23b`,
  `/a%3Fb?x=1` and `/a%2Fb`, with no scheme, host or port and no decoded or re-escaped byte.

#### Scenario: Unsafe targets

- **WHEN** GET targets `/next//evil.example`, `/next/\evil.example`, `/next/%2F%2Fevil.example` or a
  traversal form, encoded or not
- **THEN** the response SHALL be 400 and SHALL carry no `Location`.

### Requirement: Fail-closed cutover gate

The release gate SHALL pass only when every blocking item of the cutover has a recorded entry whose
issue is closed as completed, whose pull request is merged in the recorded repository, references
that issue and was merged no later than the close, and when the rollback evidence records the prior
tag and digest. With a GitHub token the gate SHALL re-check every entry against the API and fail on
any mismatch, missing repository identity or API error.

#### Scenario: Negative evidence

- **WHEN** an item is missing, an issue is open or closed as not planned, a pull request is unmerged,
  references another issue, was merged after the close, or is the same number in another repository
- **THEN** the gate SHALL exit non-zero naming the item.

### Requirement: Kit sample data never renders

The parity harness SHALL fail a journey when a settled page shows a string from
`tests/parity/kit-sample-strings.json` that no mocked response or user input supplied, after `open()`,
after every action and readiness assertion, and before teardown. `parity:validate` SHALL reject a
kit `DataTable` whose rows are not visibly supplied.

#### Scenario: Static rule

- **WHEN** a `DataTable` has a `rows` attribute after every spread, or spreads only top-level const
  object literals with a literal `rows` key that are referenced nowhere else except as JSX spreads
- **THEN** `parity:validate` SHALL accept it.
- **WHEN** it has no rows, another spread, a re-export, computed access or an unparsable file
- **THEN** `parity:validate` SHALL fail naming the file and line.
