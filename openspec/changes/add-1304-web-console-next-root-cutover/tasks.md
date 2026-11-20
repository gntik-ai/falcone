- [x] Test `/next` redirects, encoding, open-redirect, traversal, `/healthz`, assets and `/v1` at the
  request seam for `static-server.mjs` (mocked transport and real sockets).
- [x] Serve only the next bundle at `/` from `static-server.mjs`; validate the redirect in one function.
- [x] Replace the nginx `/next` locations with a raw-`$request_uri` map and one named location; add `/healthz`.
- [x] Build only next at `/` in the Dockerfile, release workflow and CI; re-include the next dist in
  `.dockerignore` and test the build context.
- [x] Add the cutover gate, its committed evidence, its offline fixtures and the CI job.
- [x] Record the prior rollback tag and digest.
- [x] Extract the kit sample strings, add `assertNoSampleData` to every settled state and the
  `parity/no-implicit-sample-data` rule, each with negative fixtures.
- [x] Repoint shell specs and workflow tests to base `/`.
- [x] falcone-charts: contract test for digest-pinned and tag-only `webConsole.image`.
- [ ] Run the nginx runtime checks in CI (nginx is not installed in the maker sandbox).
- [ ] Run `test:parity` in es and en, the shell and CSP Playwright suites, the kit tarball
  byte-compare and CodeQL in CI (no Chromium or network in the maker sandbox).
- [ ] Operator: staging rollback rehearsal, then record the switch-release digest in release evidence.
