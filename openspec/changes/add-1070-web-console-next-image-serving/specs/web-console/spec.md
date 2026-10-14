## ADDED Requirements

### Requirement: Side-by-side console serving

The single `in-falcone-web-console` image SHALL contain `/app/dist` and `/app/dist-next`, run as
UID 1000 with a read-only root filesystem and require no registry-token build arguments or
package-access credentials. The deployment SHALL retain the `webConsole` key and image name.
The static server SHALL remain zero-dependency and make no filesystem writes.

#### Scenario: Next shell and deep link

- **WHEN** GET requests target `/next`, `/next/` or `/next/console/tenants`
- **THEN** the next index SHALL return 200, `text/html`, `Cache-Control: no-store`, the exact
  legacy CSP, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy headers.

#### Scenario: Next assets and missing files

- **WHEN** a GET targets an existing `/next/assets/<hashed file>`
- **THEN** it SHALL return that file with `public, max-age=31536000, immutable` and the same
  security headers.
- **WHEN** the asset or the next bundle is absent
- **THEN** the request SHALL return 404 and SHALL NOT return legacy HTML.

#### Scenario: Traversal and preserved API edge

- **WHEN** raw or encoded dot-dot traversal targets either static root
- **THEN** it SHALL be rejected before normalization and SHALL NOT read outside either root.
- **WHEN** a request targets `/next/v1/*`
- **THEN** it SHALL stay on the next static route and SHALL NOT proxy to the gateway.
- **WHEN** the console calls the root-relative `/v1/*` API
- **THEN** GATEWAY_UPSTREAM SHALL receive its unchanged method, path, headers and body under
  the existing proxy behavior. Health and API matching SHALL precede next and legacy routing.

#### Scenario: Legacy compatibility

- **WHEN** GET targets `/healthz`
- **THEN** it SHALL return 200 and `ok`.
- **WHEN** GET targets `/`, `/assets/*` or legitimate legacy deep links
- **THEN** bytes, headers and fallback behavior SHALL match the previous server, including when
  the next bundle is absent.

### Requirement: Shared release identity and evidence

Both bundles SHALL receive the same semver-or-dev version and 7-or-40 lowercase hex commit SHA,
validated as in the legacy Vite configuration. Each HTML version meta SHALL equal the release
version. Both About entries SHALL show that version and the short SHA used by the image's
`sha-<short>` tag. Release builds SHALL use `/next/` for the next base and exclude the CSP harness.
Neither bundle SHALL embed the image digest.

#### Scenario: Published bundle mismatch

- **WHEN** either bundle's published version meta differs from the release version or is absent
- **THEN** the release workflow SHALL fail closed, including existing-image replays.

#### Scenario: Single immutable image reference

- **WHEN** publication succeeds
- **THEN** the version and SHA tags SHALL resolve to one valid digest, recorded with the pinned
  image reference in the existing release evidence summary. Both HTML checks SHALL inspect that
  exact digest. Release deployment SHALL use that digest through the deterministic Helm adapter.

#### Scenario: Unchanged deployment contracts

- **WHEN** chart unit, contract and all-core readiness suites run in their supported checkout
- **THEN** they SHALL pass without edits to `webConsole` or `in-falcone-web-console`.
