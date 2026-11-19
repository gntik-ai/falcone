# Tasks

- [x] Request-level routing tests for `static-server.mjs` (root, deep links, `/next` redirects, traversal, assets, `/v1`, `/healthz`), red before the server change.
- [x] `static-server.mjs` serves only the next dist; `/next` redirects with a relative raw-target `Location`; `/legacy` is 404.
- [x] nginx (production and kind): one redirect location, traversal guard, `/legacy` refusal, `location = /healthz` before `location /`; runtime tests run when nginx is installed (CI installs it).
- [x] Dockerfiles, `.dockerignore`, `release-images.yml` and `ci.yml` build next at `/`; build-context test; image contract script and tests.
- [x] `cutover-gate.mjs`, `release-evidence/cutover-gate.json` (57 items), CI job, six negative fixtures plus the cross-repository case and API fail-closed cases.
- [x] `release-evidence/web-console-rollback.json` with the prior tag and digest, checked by the gate.
- [x] `assertNoSampleData`, the settled-state guard, `kit-sample-strings.json` and its extraction script; negative harness cases.
- [x] `parity/no-implicit-sample-data` in `validate.mjs` with positive and negative CLI fixtures; 0 hits on `src`.
- [x] Shell specs and CI structure tests follow the root base path.
- [x] falcone-charts contract test for a digest-pinned and a tag-only `webConsole.image`.
- [ ] PR CI: `test:parity` in es and en (0 `no-sample-data` failures on all 50 pages), the shell suite at `VITE_BASE_PATH=/`, the nginx runtime tests, the image contract step, the cutover gate against the GitHub API, and the kit sample strings regeneration from the public tarball.
- [ ] Operator: record the switch-release digest in release evidence after `release-images` publishes it, run the staging rollback rehearsal with the recorded prior digest, attach its evidence, then approve the deletion release.
