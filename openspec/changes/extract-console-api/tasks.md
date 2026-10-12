## 1. Scope and Test Seams

- [x] Verify the clean assigned #1072 branch and platform lockfile commit c1267933.
- [x] Derive public package-export scenarios from the acceptance criteria, with fetch, time and
  storage as the only behavior-test stubs; keep module mock identity tests separate.
- [x] Generate synthetic base-session.json using persistConsoleShellSession from base 7acbac0.
- [x] Observe missing package export failures before each extraction slice with
  `node tests/unit/console-api.test.mjs`; observe the required CI step assertion fail before adding it.

## 2. Implementation

- [x] Move full http, auth, session, config, permissions and workspace-secrets-access modules.
- [x] Extract only the shell loaders and their type contracts; retain the React provider in the app.
- [x] Add three shell clients, retain seven auth clients and pin the complete METHOD+path set.
- [x] Add typed synthetic response builders and recursive validator accept/reject tests.
- [x] Migrate app imports and mock targets; adapt external console tests that imported moved files.
- [x] Require the console-api Vitest suite in the web-console CI job without bypassing any gate.

## 3. Verification and Handoff

- [x] Run the shared behavior scenarios using the dependency-free Node runner (32 passing tests).
- [x] Run the CI configuration test (one passing test) and confirm moved-source equality apart from
  import paths, unchanged app test cases and absence of legacy definitions/storage literal in src.
- [ ] Run `pnpm --filter @in-falcone/console-api test` including two mock-resolution cases in PR CI.
- [ ] Compare runtime app suite counts with base using `pnpm --filter @in-falcone/web-console test`.
- [ ] Inject a failing package test and verify the web-console CI job fails; remove the injection.
- [ ] Run `pnpm install --frozen-lockfile` on a clean checkout.
- [ ] Run `pnpm --filter @in-falcone/web-console exec vite build` with VITE_* sentinels and verify
  those sentinels are inlined in the bundle.
- [ ] Run `docker build -f apps/web-console/Dockerfile .` in PR/release infrastructure.

The pnpm commands cannot run in this sandbox: Node child spawning returns EPERM before the
project command starts, pnpm available here is 9.12.3 rather than pinned 10.0.0, and no workspace
node_modules exists despite the platform reinstall notice. Both native node:test files pass with `node --test` as well as direct invocation.
Docker is unavailable to the sandbox: an isolated DOCKER_CONFIG retry reports permission denied
connecting to the docker API at unix:///var/run/docker.sock. These are SKIPPED checks, with CI and the merge gate owning
their final verdict. No runtime app count equality, negative CI run, bundler or image-build success
is claimed.

The absent inventory is deferred by the approved OpenSpec. Whether u0 may merge with the four
blocking requests still open remains a control-plane decision. Operator deployment smoke testing
(login, context switching, refresh and logout) is outside this source maker's scope.
