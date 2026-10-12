## 1. Scope and Test Seams

- [x] Verify the clean assigned #1072 branch and platform lockfile commit c1267933.
- [x] Derive public package-export scenarios from the acceptance criteria, with fetch, time and
  storage as the only behavior-test stubs; keep module mock identity tests separate.
- [x] Generate synthetic base-session.json using persistConsoleShellSession from base 7acbac0.
- [x] Previous extraction attempt observed missing package export failures with an alternate
  Node runner and the required CI step assertion before adding it. The alternate runner was
  removed in the checker follow-up; it does not establish a passing package Vitest gate.

## 2. Implementation

- [x] Move full http, auth, session, config, permissions and workspace-secrets-access modules.
- [x] Extract only the shell loaders and their type contracts; retain the React provider in the app.
- [x] Add three shell clients, retain seven auth clients and pin the complete METHOD+path set.
- [x] Add typed synthetic response builders and recursive validator accept/reject tests.
- [x] Migrate app imports and mock targets; adapt external console tests that imported moved files.
- [x] Require the console-api Vitest suite in the web-console CI job without bypassing any gate.

## 3. Verification and Handoff

- [x] Reproduce the fixture-loader error twice by replaying the checker's reported HTTP asset URL
  against the existing support module. Both runs throw ERR_INVALID_URL_SCHEME at readFileSync.
- [x] Build the fixture filesystem path with fileURLToPath, dirname and join, avoiding Vite's
  `new URL(..., import.meta.url)` asset transform. The same diagnostic replay and a native
  fixture import pass after the repair. The snapshot and production modules are unchanged.
- [x] Remove the alternate node:test package runner, its resolve/load hooks and fake browser.
  The existing seven Vitest files remain the required package behavior suite.
- [x] Run `node --test tests/unit/console-api-ci.test.mjs` and strict OpenSpec validation.
  Confirm the source scans find no legacy definitions/storage literal, React or app aliases.
- [ ] Run `pnpm --filter @in-falcone/console-api test` including mock-resolution cases in PR CI.
- [ ] Compare runtime app suite counts with base using `pnpm --filter @in-falcone/web-console test`.
- [ ] Inject a failing package test and verify the web-console CI job fails; remove the injection.
- [ ] Run `pnpm install --frozen-lockfile` on a clean checkout.
- [ ] Run `pnpm --filter @in-falcone/web-console exec vite build` with VITE_* sentinels and verify
  those sentinels are inlined in the bundle.
- [ ] Run `docker build -f apps/web-console/Dockerfile .` in PR/release infrastructure.

The follow-up attempted package Vitest, app Vitest, frozen installation and Vite build. Each
command stops at pnpm's Node version probe with `spawnSync /usr/local/bin/node EPERM` before
the project command starts. Available pnpm is 9.12.3 rather than pinned 10.0.0, and workspace
node_modules is absent. The fixture replay is a narrow diagnostic, not a Vitest result. The
existing session compatibility test remains the regression at the public session-read seam.
The deliberately failing package-test CI run is unverified because Vitest cannot start and
this maker has no network or CI publication permission. The local configuration test confirms
the package command remains an unconditional required step; it does not claim a CI run.

An isolated DOCKER_CONFIG build reports permission denied connecting to the Docker API at
unix:///var/run/docker.sock. These checks are SKIPPED; CI and the merge gate own their verdicts.
No runtime app count equality, negative CI run, Vitest, bundler or image-build success is claimed
by this follow-up. No deployment files changed, so the chart reuse-values check is inapplicable.

The optional barrel-export observation was considered: fixtures already have their own subpath,
and duplicate auth exports resolve to the same binding. This test-infrastructure repair retains
the existing package export surface and production modules.

The absent inventory is deferred by the approved OpenSpec. Whether u0 may merge with the four
blocking requests still open remains a control-plane decision. Operator deployment smoke testing
(login, context switching, refresh and logout) is outside this source maker's scope.
