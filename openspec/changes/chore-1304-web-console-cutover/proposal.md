# Cut over the console to web-console-next at the root

Issue: gntik-ai/falcone#1304, request 66d77bb4-d9de-5ade-8072-396d284c81b8 revision 5.
Blueprint: 57f536f4-a597-4564-9c85-bc835b96e41f,
SHA256 d52c1d932d0f68f904568c8caf9694f0ae2046daf5220d2b6465df6a0355f15d.
Item: cutover:u5-cutover. Risk: R3. Source base: ca5183d4adf805a9545a176197994af2b8a38184.

The released console currently serves legacy at `/` and next under `/next`.
Serve only next at `/`, redirect the old next prefix with a relative 301, and
preserve the CSP, security headers, immutable asset caching, API edge and health.
Build next with base `/` and publish only its dist, with the release tag and SHA.
Keep the image name `in-falcone-web-console` and the `webConsole` chart key.

Add a fail-closed release gate over the recorded 57 blocking items, and CI checks
for parity, i18n and the request-level acceptance tests on the cutover commit.
The full blueprint is unavailable in the checkout: commit the issue revision 5
Blocked-by list as the authoritative cutover list, independently of closure evidence.
Its historical auth-config gap is represented by `gap:merged-6be392bfcea941b7`,
as explicitly recorded in the issue. Do not substitute or add another gap.
CI rechecks issues and PR identities through the GitHub API; offline evidence
records the operator's attestation without inventing timestamps or full SHAs.

Add sample-data checks at every settled parity state and a conservative static
DataTable rows validator. Preserve the existing kit pins (ui/blocks/templates
0.15.0, tokens 0.5.0 at the immutable source base), lockfile and all page code.
Extract the fixture from the installed pinned kit and record lockfile integrity.
DataTable fixtures now live in blocks; ui supplies localized textarea samples.

Record the verified prior tag and digest for deterministic chart rollback. No
runtime path, flag or header selects legacy. Keep all legacy source for one release.
Deletion, serving-config relocation, page migration, parity fixes, kit changes,
backend changes, deployment and inventing the switch-release digest are out of scope.
The companion deployment maker owns the digest/tag Helm rendering contract test.
Human approval and independent review by both providers remain required for release.
