# Web console switch-release requirements

## ADDED Requirements

### Requirement: Only next is served

GET `/`, `/login`, `/signup`, `/console/tenants`, `/console/flows/abc` MUST
return the next index, no-store, and the unchanged byte-identical CSP from both
servers. `/legacy` MUST NOT serve HTML. Missing assets MUST return 404; hashed
assets MUST have `public, max-age=31536000, immutable`. `/v1/x` MUST reach the
upstream intact without SPA security headers. `/healthz` MUST return 200 `ok`.

#### Scenario: Raw redirects

`/next`, `/next?x=1`, `/next/a%2Fb`, `/next/a%23b`, `/next/a%3Fb?x=1` and
`/%6Eext/a%2Fb` MUST return relative 301 locations `/`, `/?x=1`, `/a%2Fb`,
`/a%23b`, `/a%3Fb?x=1` and `/a%2Fb`. Traversal, including encoded traversal,
MUST return 400 before a redirect. Redirect security headers MUST match Node.

### Requirement: Release gates fail closed

The complete 57-item file MUST pass. Missing, extra or duplicate items,
NOT_PLANNED/open issues, unmerged PRs, wrong issue references, late merges,
wrong/missing repository identities and API mismatches/errors MUST fail.
CI MUST require its GitHub token and recheck live evidence; offline tests MUST
use fixtures only. Parity/i18n and request-level tests MUST pass on the cutover commit.

### Requirement: Sample data cannot silently appear

Every settled parity state in es and en MUST reject committed kit sample copy.
A negative journey with late sample text MUST fail. Static validation MUST reject
DataTable rows it cannot prove, including shadowed/defaulted bindings, reassignments,
mutations, unresolved spreads and later overrides. Explicit API data rows MUST pass.

### Requirement: Images and rollback remain reproducible

The image MUST contain only next dist, built at `/`, with release tag/SHA rather
than dev. It MUST run as UID 1000 on a read-only root with no package token.
The build context MUST include next/dist. Prior rollback evidence MUST contain
tag `sha-ca5183d` and digest
`sha256:77e614f1a084b2ada754bccfab37c6018ffed5302078e87c89c055dd8c80dd5a`.
Legacy source MUST stay for this release. Recovery MUST use the prior chart/digest
through the deterministic Helm adapter. The switch digest MUST NOT be guessed.
